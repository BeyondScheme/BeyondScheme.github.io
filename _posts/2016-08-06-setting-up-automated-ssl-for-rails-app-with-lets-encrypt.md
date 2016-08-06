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

I needed a secure connection for my API rails application because my gem called knapsack_pro, which is responsible for optimizing test suite split, sends test file names to API where the test suite split is happening. I wanted to keep connection more secure with SSL/TLS.

I was looking for options like maybe buying a cheap certificate for a year but I needed a few certificate for a few domains: main website, api domain, staging website and api staging domain.

A while ago I read on hacker news about [Let's Encrypt](https://letsencrypt.org). It's is a new Certificate Authority sponsored by many companies. They are aiming for a few things:

* free certificates
* ssl renewal process should be automated (no more buying a certificate every year and manually updating it on the server)
* open certificates

What differentiates Let's Encrypt from other Certificate Authorities is that Let's Encrypt has ninety-day lifetimes for certificates. One of the reasons of ninety-day lifetimes is that it encourage automation. We can’t continue to expect system administrators to manually handle renewals. More explanation you can [find here](https://letsencrypt.org/2015/11/09/why-90-days.html).

# What you are going to learn

In this article I'm going to show you how to:

* create capistrano tasks to:
  * register Let's Encrypt client
  * authorize domain on Let's Encrypt
  * obtain a certificate from Let's Encrypt
* create rake task for certificate renewal process and how to run it via cron
