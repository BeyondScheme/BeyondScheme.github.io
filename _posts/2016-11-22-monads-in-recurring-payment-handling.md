---
layout: post
title:  "Monads in recurring payment handling"
date:   2016-11-22 08:00:00 +0200
author: "Artur Trzop"
tags: ruby monads
---

Maybe you heard about this weird thing called monad. Maybe you even tried to read more about the topic but you never use it in practice. Sometimes real usage examples can help to understand when might be worth it to look into monads and then try to pick a monad for our problem.

I'm going to show you what was my problem while working on a payment handling system. I will leave the questions like what is the monad and what are examples of monads for the end of the article because there are already a lot of resources covering that.

# Recurring payment system

A while ago I was working on integration with Braintree Payments and my website KnapsackPro.com so companies that are doing optimal test suite parallelisation in ruby with my tool can switch to paid monthly plan. Basically, the case was to have subscription-based billing.

I needed to handle a few things on the payment form.

* form has to be validated
* customer has to be created or his data should be updated in payment system (Braintree)
* subscription plan has to be created or updated with proper price in payment system

If we put that in pseudo code it would look like this:

{% highlight ruby %}
if customer_data_valid?
  if customer_created_or_updated_in_payment_system?
    if subscription_created_or_updated_in_payment_system?
      show_success
    else
      show_errors
    end
  else
    show_errors
  end
else
  show_errors
end
{% endhighlight %}

As you can see there are a few cases when something can go wrong and we will have to show errors for the particular step that failed. You can imagine how `if` structure builds up when you have more cases to handle.

Here you can see my real code example. It's just `create` action from Ruby on Rails controller. Part of the responsibilities like `create` or `update` for customer or subscription records in Braintree payment system was extracted to service objects called with suffix `upsert`. Those services are responsible for operation of `create` or `update` when the record already exists.

{% highlight ruby %}
# app/controllers/dashboard/billings_controller.rb
def create
  customer = Customer.build_from(params)
  customer_validator = CustomerValidator.new(customer)

  if customer_validator.valid?
    payment_method_nonce = params[:payment_method_nonce]
    device_data = params[:device_data]
    customer_id = organization.id
    payment_method_token = customer_id

    customer_upsert_response = Billing::CustomerUpsert.new(
      customer_id: customer_id,
      payment_method_token: payment_method_token,
      payment_method_nonce: payment_method_nonce,
      device_data: device_data,
      customer: customer
    ).call

    if customer_upsert_response.success?

      plan_id = "knapsack_pro_monthly"
      subscription_upsert_response = Billing::SubscriptionUpsert.new(
        subscription: find_subscription,
        payment_method_token: payment_method_token,
        plan_id: plan_id,
        price: price
      ).call

      if subscription_upsert_response.success?
        organization.update_attribute(:subscription_activated, true)
        flash[:success] = 'Your billing plan has been activated. Thanks for supporting us!'
        redirect_to dashboard_billing_path and return
      else
        flash.now[:error] = subscription_upsert_response.message
      end

    else
      flash.now[:error] = customer_upsert_response.message
    end

  else
    flash.now[:error] = customer_validator.error_message
  end

  @customer = customer
  @subscription = find_subscription
  @price = price
  render :new
end
{% endhighlight %}
