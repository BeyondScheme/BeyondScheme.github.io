---
layout: post
title:  "Setting up automated SSL/TLS for Rails app with Let's Encrypt"
date:   2016-08-08 08:00:00 +0200
author: "Artur Trzop"
tags:
  - SSL
  - TLS
  - certificate
  - Rails
  - https
  - Let's Encrypt
---

Recently I was working on adding https to my website [KnapsackPro.com](https://knapsackpro.com) and I'd like to share some tips with you how to configure SSL/TLS in rails application for free with Let's Encrypt.

<img src="/images/blog/posts/setting-up-automated-ssl-for-rails-app-with-lets-encrypt/lets_encrypt.png" style="float:right;width:300px;" />

I needed a secure connection for my API rails application because my gem called [knapsack_pro](https://github.com/KnapsackPro/knapsack_pro-ruby), which is responsible for optimizing test suite split, sends test file names to API where the test suite split is happening. I wanted to keep connection more secure with SSL/TLS.

I was looking for options like maybe buying a cheap certificate for a year but I needed a few certificate for a few domains: main website, api domain, staging website and api staging domain.

A while ago I read on hacker news about [Let's Encrypt](https://letsencrypt.org). It's is a new Certificate Authority sponsored by many companies. They are aiming for a few things:

* free certificates for everyone
* ssl renewal process should be automated (no more buying a certificate every year and manually updating it on the server)
* automatic issuance and renewal protocol as an open standard

What differentiates Let's Encrypt from other Certificate Authorities is that Let's Encrypt has ninety-day lifetimes for certificates. One of the reasons of ninety-day lifetimes is that it encourage automation. We can’t continue to expect system administrators to manually handle renewals. More explanation you can [find here](https://letsencrypt.org/2015/11/09/why-90-days.html).

# What you are going to learn

In this article I'm going to show you how to:

* create capistrano tasks to:
  * register Let's Encrypt client
  * authorize domain on Let's Encrypt
  * obtain a certificate from Let's Encrypt
* create rake task for certificate renewal process and how to run it via cron

# How to work with Let's Encrypt

There are multiple Let's Encrypt clients but we are going to focus on [acme-client](https://github.com/unixcharles/acme-client/).
Let's add the gem to your project:

{% highlight plain %}
# Gemfile
gem 'acme-client', require: false
{% endhighlight %}

Remember to run `bundle install` after that.

# Capistrano task to register Let's Encrypt client

We have to create an account on Let's Encrypt in order to authenticate our client. The capistrano task will handle that and create a new private key which will be registered on Let's Encrypt.

When you will try to run the task for the second time it will skip registration process because the private key exists.
Thanks to that we will be able to use the task during deployment via capistrano. The task will create a private key and register it on Let's Encrypt only when that's necessary.

{% highlight ruby %}
# lib/capistrano/tasks/letsencrypt/register_client.rake
namespace :letsencrypt do
  task :register_client do
    on roles(:app) do
      contact_email = fetch(:letsencrypt_contact_email) || raise('Missing contact email')
      letsencrypt_dir = fetch(:letsencrypt_dir) || raise('Missing letsencrypt directory')
      private_key_path = fetch(:letsencrypt_private_key_path) || raise('Missing private key path')

      # We need an ACME server to talk to, see github.com/letsencrypt/boulder
      # WARNING: This endpoint is the production endpoint, which is rate limited and will produce valid certificates.
      # You should probably use the staging endpoint for all your experimentation:
      # endpoint = 'https://acme-staging.api.letsencrypt.org/'
      endpoint = fetch(:letsencrypt_endpoint) || raise('Missing letsencrypt endpoint')


      # make the config letsencrypt dir
      execute :mkdir, "-p #{letsencrypt_dir}"

      if test("[ -f #{private_key_path} ]")
        info "Private key file already exists at #{private_key_path}"
        info "If you want to generate a new private key then please remove the current private key and then run task again."
      else
        # We're going to need a private key.
        require 'openssl'
        private_key = OpenSSL::PKey::RSA.new(4096)
        upload! StringIO.new(private_key.to_pem), private_key_path

        # Initialize the client
        require 'acme-client'
        client = Acme::Client.new(private_key: private_key, endpoint: endpoint)

        # If the private key is not known to the server, we need to register it for the first time.
        registration = client.register(contact: "mailto:#{contact_email}")

        # You may need to agree to the terms of service (that's up the to the server to require it or not but boulder does by default)
        registration.agree_terms
      end
    end
  end
end
{% endhighlight %}

We also need to ensure capistrano gem can see our task. Add below the line at the end of your `Capfile` if the line is missing.

{% highlight ruby %}
# Capfile
Dir.glob('lib/capistrano/tasks/**/*.rake').each { |r| import r }
{% endhighlight %}

# Capistrano task to authorize domain on Let's Encrypt

We have to prove that we are in control of our domain before we are able to obtain a certificate from Let's Encrypt.
Let's create another capistrano task for that:

{% highlight ruby %}
# lib/capistrano/tasks/letsencrypt/authorize_domain.rake
namespace :letsencrypt do
  task :authorize_domain do
    on roles(:app) do
      letsencrypt_dir = fetch(:letsencrypt_dir) || raise('Missing letsencrypt directory')
      letsencrypt_authorize_domains = fetch(:letsencrypt_authorize_domains) || raise('Missing letsencrypt authorize domains')
      private_key_path = fetch(:letsencrypt_private_key_path) || raise('Missing private key path')

      # We need an ACME server to talk to, see github.com/letsencrypt/boulder
      # WARNING: This endpoint is the production endpoint, which is rate limited and will produce valid certificates.
      # You should probably use the staging endpoint for all your experimentation:
      # endpoint = 'https://acme-staging.api.letsencrypt.org/'
      endpoint = fetch(:letsencrypt_endpoint) || raise('Missing letsencrypt endpoint')


      private_key = OpenSSL::PKey::RSA.new(capture(:cat, private_key_path))

      # Initialize the client
      require 'acme-client'
      client = Acme::Client.new(private_key: private_key, endpoint: endpoint)

      letsencrypt_authorize_domains.split.each do |domain|
        info "Domain: #{domain}"

        challenge_json_path = "#{letsencrypt_dir}/challenge_#{domain}.json"
        authorization = client.authorize(domain: domain)

        run_verification = false

        unless test("[ -f #{challenge_json_path} ]")
          # This example is using the http-01 challenge type. Other challenges are dns-01 or tls-sni-01.
          challenge = authorization.http01

          # The http-01 method will require you to respond to a HTTP request.

          # You can retrieve the challenge token
          info challenge.token # => "some_token"

          # You can retrieve the expected path for the file.
          info challenge.filename # => ".well-known/acme-challenge/:some_token"

          # You can generate the body of the expected response.
          info challenge.file_content # => 'string token and JWK thumbprint'

          # You are not required to send a Content-Type. This method will return the right Content-Type should you decide to include one.
          info challenge.content_type

          # save the challenge for use at another time
          upload! StringIO.new(challenge.to_h.to_json), challenge_json_path

          run_verification = true
        end


        challenge_json = capture :cat, challenge_json_path

        # Load a saved challenge. This is only required if you need to reuse a saved challenge as outlined above.
        challenge = client.challenge_from_hash(JSON.parse(challenge_json))

        # Save the file. We'll create a public directory to serve it from, and inside it we'll create the challenge file.
        execute :mkdir, "-p #{release_path}/public/#{File.dirname(challenge.filename)}"

        # We'll write the content of the file
        challenge_public_path = "#{release_path}/public/#{challenge.filename}"
        upload! StringIO.new(challenge.file_content), challenge_public_path
        execute :chmod, "+r #{challenge_public_path}"


        if run_verification
          # Once you are ready to serve the confirmation request you can proceed.
          challenge.request_verification # => true
          info "Verify status: #{challenge.verify_status}" # => 'pending'

          # Wait a bit for the server to make the request, or just blink. It should be fast.
          sleep(3)

          info "Verify status: #{challenge.verify_status}" # => 'valid'
        else
          info "Skipped verification of challenge. It's already verified. If you want to verify different domain please remove file:"
          info "#{challenge_json_path} and run the task again."
        end
      end
    end
  end
end
{% endhighlight %}

# Capistrano task to obtain a certificate from Let's Encrypt

The last step is to obtain a certificate. We can add a task for that:

{% highlight ruby %}
# lib/capistrano/tasks/letsencrypt/obtain_certificate.rake
namespace :letsencrypt do
  task :obtain_certificate do
    on roles(:app) do
      certificate_request_domains = fetch(:letsencrypt_certificate_request_domains) || raise('Missing certificate request domains')
      letsencrypt_dir = fetch(:letsencrypt_dir) || raise('Missing letsencrypt directory')
      certificate_dir = "#{letsencrypt_dir}/certificate"
      private_key_path = fetch(:letsencrypt_private_key_path) || raise('Missing private key path')
      endpoint = fetch(:letsencrypt_endpoint) || raise('Missing letsencrypt endpoint')

      cert_privkey_path = "#{certificate_dir}/privkey.pem"
      cert_path = "#{certificate_dir}/cert.pem"
      cert_chain_path = "#{certificate_dir}/chain.pem"
      cert_fullchain_path = "#{certificate_dir}/fullchain.pem"

      # ensure certificate dir exists
      execute :mkdir, "-p #{certificate_dir}"

      if test("[ -f #{cert_fullchain_path} ]") && test("[ -f #{cert_privkey_path} ]")
        info "Certificate already exists."
      else
        info "Missing certificate. Let's create a new certificate request."
        private_key = OpenSSL::PKey::RSA.new(capture(:cat, private_key_path))

        # Initialize the client
        require 'acme-client'
        client = Acme::Client.new(private_key: private_key, endpoint: endpoint)

        # We're going to need a certificate signing request. If not explicitly
        # specified, the first name listed becomes the common name.
        csr = Acme::Client::CertificateRequest.new(names: certificate_request_domains.split)

        # We can now request a certificate. You can pass anything that returns
        # a valid DER encoded CSR when calling to_der on it. For example an
        # OpenSSL::X509::Request should work too.
        certificate = client.new_certificate(csr) # => #<Acme::Client::Certificate ....>

        # Save the certificate and the private key to files
        upload! StringIO.new(certificate.request.private_key.to_pem), cert_privkey_path
        upload! StringIO.new(certificate.to_pem), cert_path
        upload! StringIO.new(certificate.chain_to_pem), cert_chain_path
        upload! StringIO.new(certificate.fullchain_to_pem), cert_fullchain_path

        info "Certificate created."
      end

      info "Creating symlinks for existing certificate."
      # this is path based on example in
      # https://github.com/KnapsackPro/capistrano-cookbook/blob/master/lib/capistrano/cookbook/templates/nginx.conf.erb#L54,L55
      # #{shared_path}/ssl_private_key.key is a path where nginx is looking for ssl certificate
      sudo "ln -nfs #{cert_privkey_path} #{shared_path}/ssl_private_key.key"
      sudo "ln -nfs #{cert_fullchain_path} #{shared_path}/ssl_cert.crt"
    end
  end
end
{% endhighlight %}

Please note that I'm using nginx and [my nginx configuration](https://github.com/KnapsackPro/capistrano-cookbook/blob/master/lib/capistrano/cookbook/templates/nginx.conf.erb#L54,L55) is looking for ssl cert and ssl private key in shared directory. In your case, it might be a different directory. You need to ensure your server like nginx or apache has enabled SSL and specified the path where to look for the certificate.

# Configuration of capistrano so it will work with our tasks

Now we need to add proper configuration variables for our production environment.

{% highlight ruby %}
# config/deploy/production.rb
set :letsencrypt_contact_email, 'name@example.com'
set :letsencrypt_dir, "#{shared_path}/config/letsencrypt"
set :letsencrypt_endpoint, 'https://acme-v01.api.letsencrypt.org/'
set :letsencrypt_private_key_path, "#{fetch(:letsencrypt_dir)}/private_key.pem"
set :letsencrypt_authorize_domains, 'example.com www.example.com'
set :letsencrypt_certificate_request_domains, 'example.com www.example.com'
{% endhighlight %}

Another thing we need to remember of is to ensure our capistrano tasks will be run during deployment. Let's update deploy configuration:

{% highlight ruby %}
# config/deploy.rb
after 'deploy:symlink:release', 'letsencrypt:register_client'
after 'letsencrypt:register_client', 'letsencrypt:authorize_domain'
after 'letsencrypt:authorize_domain', 'letsencrypt:obtain_certificate'
after 'letsencrypt:obtain_certificate', 'nginx:reload'
{% endhighlight %}

We need to reload nginx server after we obtain the certificate.
I assume you have the task like `nginx:reload` or something similar for another http server like apache.

# Create rake task for certificate renewal process

We would like to have an automated process of certificate renewal. In order to do that, we can create a rake task. You may ask why rake task instead of capistrano task? We will use rake task because we would like to run the task via cron every week.

{% highlight ruby %}
# lib/tasks/letsencrypt/renew_certificate.rake
namespace :letsencrypt do
  task :renew_certificate do
    if Rails.env.production?
      endpoint = 'https://acme-v01.api.letsencrypt.org/'
      certificate_request_domains = 'example.com www.example.com'
      certificate_dir = "/home/deploy/apps/rails_app_example_production/shared/config/letsencrypt/certificate"
      private_key_path = "/home/deploy/apps/rails_app_example_production/shared/config/letsencrypt/private_key.pem"
    else
      # Use staging endpoint to generate test certificate for you non production environment.
      # Your browser will detect it as unknown certificate.
      endpoint = 'https://acme-staging.api.letsencrypt.org/'
      certificate_request_domains = 'staging.example.com'
      certificate_dir = "/home/deploy/apps/rails_app_example_staging/shared/config/letsencrypt/certificate"
      private_key_path = "/home/deploy/apps/rails_app_example_staging/shared/config/letsencrypt/private_key.pem"
    end

    cert_privkey_path = "#{certificate_dir}/privkey.pem"
    cert_path = "#{certificate_dir}/cert.pem"
    cert_chain_path = "#{certificate_dir}/chain.pem"
    cert_fullchain_path = "#{certificate_dir}/fullchain.pem"

    if File.exists?(cert_privkey_path) && File.exists?(cert_path) && File.exists?(cert_chain_path) && File.exists?(cert_fullchain_path)
      private_key = OpenSSL::PKey::RSA.new(File.read(private_key_path))

      # Initialize the client
      require 'acme-client'
      client = Acme::Client.new(private_key: private_key, endpoint: endpoint)

      # We're going to need a certificate signing request. If not explicitly
      # specified, the first name listed becomes the common name.
      csr = Acme::Client::CertificateRequest.new(names: certificate_request_domains.split)

      # We can now request a certificate. You can pass anything that returns
      # a valid DER encoded CSR when calling to_der on it. For example an
      # OpenSSL::X509::Request should work too.
      certificate = client.new_certificate(csr) # => #<Acme::Client::Certificate ....>

      # Save the certificate and the private key to files
      File.write(cert_privkey_path, certificate.request.private_key.to_pem)
      File.write(cert_path, certificate.to_pem)
      File.write(cert_chain_path, certificate.chain_to_pem)
      File.write(cert_fullchain_path, certificate.fullchain_to_pem)

      puts "[#{Time.now}] Certificate renewed!"
    else
      puts "[#{Time.now}] Current certificate doesn't exist so you cannot renew it. Please deploy app to generate a new certificate."
    end
  end
end
{% endhighlight %}

# Add certificate renewal task to cron

If you are using [whenever](https://github.com/javan/whenever) gem with capistrano then you can just update schedule file:

{% highlight ruby %}
# config/schedule.rb
every :saturday, at: '03:00', roles: [:app] do
  rake 'letsencrypt:renew_certificate'
end

# nginx reload should happen after certificate was renewed
every :saturday, at: '03:01', roles: [:app] do
  command 'sudo service nginx reload'
end
{% endhighlight %}

We reload nginx server after certificate renewal in order to use a new certificate. That's it.

# Final step

Now when everything is ready you can just deploy your code. The first deploy will register a client, authorize domain and obtain the certificate from Let's Encrypt. It will also add to crontab our rake task responsible for the automated process of certificate renewal.

{% highlight plain %}
$ bundle exec cap production deploy
{% endhighlight %}

Hope those tips will help you set up your rails application with free certificates from Let's Encrypt.
