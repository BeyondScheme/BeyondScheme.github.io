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

At this point, you are familiar with technical details regarding application
so it is high time to look into the plan.


# <b>1. Verify your application's configuration.</b>
It is a common thing for web application to has ability to configure session management.
The variety of configuration is based on the web framework you decide to use.
Since I used Spring MVC,

# <b>2. Detect any custom session management mechanisms.</b>
Lorem ipsum.

# <b>3. Enhance monitoring users' behaviour.</b>
 -- Session logging
 -- Google Analytics


# <b>4. Analyze your infrastructure.</b>
Lorem ipsum.

# <b>5. Prepare automatic tests.</b>
Automation is your friend, keep it in mind. I found it impossible to repeat the
unexpected logouts on my own, yet still users had a problem. The only option that
was left to repeat the problem was to prepare automatic
[Selenium](http://www.seleniumhq.org/) based test. The idea behind the test was
simple - perform actions on the website until the test receives logout.





* Choose proper user type.
* Choose sample websites to perform actions on.
* Choose the actions that will be performed (e.g. edit a form).
* After each performed action we should
* Track start time, end time and current action time of the test.
* Exception/Error handling.

The listing below represents the configuration for my test.
1. Test prepared with [Selenium](http://www.seleniumhq.org/).
2. Test

# <b>6. Analyze the results.</b>
Analyse of the results is the most of important thing.


# Summary
This is the end of the blog post. After this reading, you should be able to have
a better overview how to deal with tricky cases regarding session management in
your web applications. I hope that it might help you as it helped myself. If you
have any thoughts or questions, please share them in the comments.
