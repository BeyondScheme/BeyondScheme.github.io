---
layout: post
title:  "6 steps to detect wrong session management in your web application"
date:   2016-05-13 08:00:00 +0200
author: "Kamil Kubacki"
tags: web springmvc session-management java
---




I would like to share with you 6 steps that may help in detecting the
cause of wrong session management in your web application. The steps were prepared
based on the experience with finding out the root cause of unexpected users' logouts
in my web application.

# Introduction
The application I am writing about is a Spring MVC based app with support
of Spring Security for authentication and authorization management.
The application is deployed into multiple [JBoss AS](http://jbossas.jboss.org/)
instances on multiple machines. Each JBoss instance is balanced by
[Apache HTTP Server](https://httpd.apache.org/) and each of the machines is
balanced by load balancer. To give you better view at the infrastructure
please take a look at the picture below.

<img src="/images/blog/posts/session-management/architecture.png"
style="float:right;margin-left:20px;" />


As mentioned in the beginning of the post, I started receiving feedback from
users that they were being logged from application during continuous usage,
e.g. by clicking through menu items. At first, I thought that the cause of
the logouts was the fact that users exceeded the allowed idle time (which was
set to 30 minutes). Unfortunately, users confirmed that sometimes logouts happen
few minutes after their logins. I needed to confirm it by myself. Guess what?
I was not able to reproduce it.

# <b>1. Verify your application's configuration.</b>
It is common for web application to has ability to configure session management.
The variety of configuration varies based on the web framework you decide to use.
Since I used Spring MVC

# <b>2. Detect any custom session management mechanisms.</b>
Lorem ipsum.

# <b>3. Start monitoring users' behaviour.</b>
Lorem ipsum.

# <b>4. Analyze your infrastructure.</b>
Lorem ipsum.

# <b>5. Prepare automatic tests.</b>
Lorem ipsum.

# <b>6. Analyze the results.</b>
Lorem ipsum.


# Summary
Lorem ipsum.
