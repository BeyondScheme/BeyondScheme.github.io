---
layout: post
title:  "old"
date:   2016-05-13 08:00:00 +0200
author: "Kamil Kubacki"
tags: loadbalancer web springmvc session
---



<h3>Introduction</h3>
I would like to share with you an experience regarding unexpected logouts which
users experienced while using one of the web application I developed.
I started receiving feedback from users who claimed that they were
logged out from application just after few minutes they logged in. The actions
they performed were not a
That was the time, when the problem with finding solution appeared.





<h3>Architecture</h3>
The application I am writing about is a Spring MVC web application with
support of Spring Security. The application is deployed to Application Server
on multiple machines. Each machine contains of few application instances
which are load balanced by Apache. In front of everything there is load balancer
which tries to balance the traffic to all of the machines.
That is the overview of the environment. The picture below represents it.


<img src="/images/blog/posts/load-balancer-user-sessions/architecture.png" style="float:right;margin-left:20px;" />

<h3>Investigation</h3>

I was struggling for some time to get the right steps to debug the problem.

1. Verify custom changes to application.
2. Verify users' flow on Google Analytics.
3. Enable Session logging.
4. Check cookies.
5. Verify load balancing configuration.


<h3>Solution</h3>


- httpsessionlistener
- httpsessioneventpublisher
- environment
- apache
- jvmRoute
- Big F5
- dodawanie informacji o session id
