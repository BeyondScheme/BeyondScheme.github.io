---
layout: post
title:  "6 steps to detect wrong session management in your web application"
date:   2016-05-13 08:00:00 +0200
author: "Kamil Kubacki"
tags: web java springmvc
---


I would like to share with you six steps that may help in solving problems related
to wrong session management and/or wrong infrastructure configuration for your
web applications, especially Java web applications.

# Introduction
The steps were prepared based on the real experience with finding
out the root cause of unexpected users' logouts in my Spring MVC web application.
Users' claimed that they were being logged out during continuous usage of
application (e.g. during clicking through menu). At first, I was trying to reproduce
those unexpected logouts on my own but it resulted in failure. First idea led me
to thinking that users were logged out due to exceeded idle timeout available.
My assumptions were denied by clients so I started looking for the help in
the Internet. I was not able to find a clear way to deal with those kind of
problems so I prepared a plan to figure out the solution. The plan consists of
six steps and this blog post represents it.

# Application and infrastructure (overview)
The application I am writing about is a Spring MVC based app with support
of Spring Security for authentication and authorization management.
The application is deployed into multiple [JBoss AS](http://jbossas.jboss.org/)
instances on multiple machines. Each JBoss instance is balanced by
[Apache HTTP Server](https://httpd.apache.org/) and each of the machines is
balanced by load balancer. To give you better view at the infrastructure
please take a look at the picture below.

<img src="/images/blog/posts/session-management/architecture.png" alt="infrastructure" />


# The six steps

At this point, you are familiar with technical details regarding application
so it is high time to look into the plan.

# <b>1. Verify your application's configuration.</b>
It is a common thing for web application to has ability to configure session management.
The variety of configuration is based on the web framework you decide to use.
Since I used Spring MVC,

# <b>2. Detect any custom session management mechanisms.</b>
Lorem ipsum.

# <b>3. Enhance monitoring users' behavior.</b>
 -- Session logging
 -- Google Analytics


# <b>4. Analyze your infrastructure.</b>
Lorem ipsum.

# <b>5. Prepare automatic tests.</b>
Automation is your friend, keep it in mind. I found it impossible to repeat the
unexpected logouts on my own, yet still users had a problem. The only option that
was left to repeat the problem was to prepare automatic
[Selenium](http://www.seleniumhq.org/) based test. The idea behind the test was
simple - perform actions on the website until the test receives logout. That sort
of test combined with proper users' activity monitoring helps a lot in debugging
the issue.

I would like to share with you couple of rules that should be followed for tests
like this:

* Choose one user for the test.
* Choose exact pages to perform actions on.
* Choose exact actions that will be performed (e.g. edit a form).
* Each performed action should be followed by implicit wait (remember - users are
  not as fast as Selenium).
* Track start time and current action time of the test - helps in investigation.
* Exception/Error handling - if Exception/Error happens you must have all the
information you need to debug the cause, i.e.:
  * The cause of an Exception/Error.
  * The time at which an Exception/Error happened.
  * The page that test user was at during Exception/Error.
* Tests should be run in the loop for some amount of time - users spend some time
on your website.
* Run the test via automation server, e.g. [Jenkins](https://jenkins.io/) - setup
the job to be ran multiple times a day.

The listing below represents the configuration for my test:

* Test prepared with [Selenium](http://www.seleniumhq.org/).
* Test performs actions on the website in the loop for 2 hours.
* [Jenkins](https://jenkins.io/) job prepared to run test multiple times during
the day, especially during the time of increased traffic on the website.

I must admit that this step was the crucial one in finding the cause of the problem.
I highly encourage you not to forget about automation in debugging issues like
that.

# <b>6. Analyze the results.</b>
Analyse of the results is the most of important thing.


# Summary
This is the end of the blog post. After this reading, you should be able to have
a better overview how to deal with tricky cases regarding session management in
your web applications. I hope that it might help you as it helped myself. If you
have any thoughts or questions, please share them in the comments.
