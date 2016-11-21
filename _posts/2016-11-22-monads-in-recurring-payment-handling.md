---
layout: post
title:  "Monads in recurring payment handling"
date:   2016-11-22 08:00:00 +0200
author: "Artur Trzop"
tags: ruby monads
---

Maybe you heard about this weird thing called monad. Maybe you even tried to read more about the topic but you never use it in practice. Sometimes real usage examples can help to understand when it might be worth to look into monads and then try to pick a monad for our problem.

<a href="https://en.wikipedia.org/wiki/Monad_(philosophy)"><img src="/images/blog/posts/monads-in-recurring-payment-handling/monad.png" style="float:right;margin-left:20px;width:300px;" /></a>

I am going to show you what my problem was while working on a payment handling system. I will leave the questions like what is the monad and what are examples of monads to the end of the article because there are already a lot of resources covering that.

# Recurring payment system

A while ago I was working on integration with Braintree Payments and my website, so companies that are doing [optimal test suite parallelisation in ruby](https://knapsackpro.com/features?utm_source=beyond_scheme&utm_medium=blog_post&utm_campaign=monads&utm_content=optimal_parallelisation) with my tool can switch to paid monthly plan. Basically, the case was to have subscription-based billing.

I needed to handle a few things on the payment form:

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

Here you can see my real code example. It is just `create` action from Ruby on Rails controller. Part of the responsibilities like `create` or `update` for customer or subscription records in Braintree payment system was extracted to service objects called with suffix `Upsert`. Those services are responsible for the operation of `create` or `update` when the record already exists.

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

# Either monad

The flow in `billings controller` is simple. When something is ok then continue. If something is wrong then stop and return an error. There is monad for this called `Either`.

There is a great gem called [dry-monads](http://dry-rb.org/gems/dry-monads/) that have a few common monads for Ruby. We are going to use it.

The `Either` monad has two type constructors: `Right` and `Left`. The `Right`
is for everything went right cases and the `Left` is used when something has gone wrong.

We are going to do one more thing. Extract the logic to separate service `Billing::Payment` and keep controller more readable.

{% highlight ruby %}
# app/controllers/dashboard/billings_controller.rb
def create
  payment = Billing::Payment.new(
    organization: organization,
    plan_price: plan_price,
    params: params
  )
  payment_result = payment.call

  if payment_result.success?
    flash[:success] = 'Your billing plan has been activated. Thanks for supporting us!'

    redirect_to dashboard_billing_path
  else
    flash.now[:error] = payment_result.value

    @customer = payment.customer
    @subscription = Billing::Subscription.find_for(organization)
    @plan_price = plan_price

    render :new
  end
end
{% endhighlight %}

And here is the logic for service with Either monad.

{% highlight ruby %}
# app/services/billing/payment.rb
class Billing::Payment
  include Dry::Monads::Either::Mixin

  attr_reader :customer

  def initialize(
    organization:,
    plan_price:,
    params:
  )
    @organization = organization
    @plan_price = plan_price
    @params = params
    @customer = Billing::CustomerEntity.build_from(params)
  end

  def call
    Right(true).bind do |_|
      customer_validator = CustomerValidator.new(customer)
      if customer_validator.valid?
        Right(true)
      else
        Left(customer_validator.error_message)
      end
    end.bind do |_|
      customer_upsert_response = Billing::CustomerUpsert.new(
        customer_id: customer_id,
        payment_method_token: payment_method_token,
        payment_method_nonce: payment_method_nonce,
        device_data: device_data,
        customer: customer
      ).call

      if customer_upsert_response.success?
        Right(true)
      else
        Left(customer_upsert_response.message)
      end
    end.bind do |_|
      subscription_upsert_response = Billing::SubscriptionUpsert.new(
        subscription: Billing::Subscription.find_for(organization),
        payment_method_token: payment_method_token,
        plan_id: plan_id,
        plan_price: plan_price
      ).call

      if subscription_upsert_response.success?
        organization.update_attribute(:subscription_activated, true)
        Right(true)
      else
        Left(subscription_upsert_response.message)
      end
    end
  end

  private

  attr_reader :organization,
    :plan_price,
    :params

  def payment_method_nonce
    params[:payment_method_nonce]
  end

  def device_data
    params[:device_data]
  end

  def customer_id
    organization.id
  end

  def payment_method_token
    customer_id
  end

  def plan_id
    'knapsack_pro_monthly'
  end
end
{% endhighlight %}

When we run `call` method on the service `Billing::Payment` we will get `Right` or `Left` object as a result. We can call on the result the `success?` method to check whether all was right or not. By calling method `value` we get what was passed to `Right` or `Left` constructor. In the case of `Right` the value will be `true` because we set that. For `Left` the value is the error for a step that failed. Simple as that. You can easily extend this by binding more cases if you need that.

# Demystifying monads

To understand monads we need to first ask the question why do we even need monads. There is a great simple explanation on StackOverflow based on [a problem with dividing by zero and applying a function on the result.](http://stackoverflow.com/a/28135478/905697)

When you will grasp the idea behind monads then it is worth to check other related concepts like functors and applicatives. There is a great article about [functors, applicatives, and monads in pictures](http://adit.io/posts/2013-04-17-functors,_applicatives,_and_monads_in_pictures.html).

If you want to learn more about monads in Ruby examples then definitely check presentation [Refactoring Ruby with Monads by Tom Stuart](https://www.youtube.com/watch?v=J1jYlPtkrqQ).

Do not forget the dry-monads gem has other monads examples like `Maybe` or `Try` monad. Check the [dry-monads docs](http://dry-rb.org/gems/dry-monads/)!
