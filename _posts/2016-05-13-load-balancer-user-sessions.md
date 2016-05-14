---
layout: post
title:  "BigIP F5 - user sessions managment"
date:   2016-05-13 08:00:00 +0200
author: "Kamil Kubacki"
tags: loadbalancer spring bigip f5 springmvc
---

I would like to share with you an experience regarding unexpected session timeouts which users experienced
while using one of the web application I developed.

Introduction

My team started receiving feedback from users who said that they were being logged out from application just after
few minutes they logged in. First thing that came to my mind was to try to reproduce the situation users experienced.
That was the time, when the problem with finding solution appeared.

Architecture

The application I am writing about, is a Spring MVC web application with support of Spring Security.
The application is deployed to JBoss on multiple machines. Each machine contains few of JBoss instances which
are load balanced by Apache. In front of everything there is load balancer
(<a href="https://f5.com/products/big-ip">BigIP F5</a>) which tries to balance the traffic to all of the machines.
BigIP's configuration hits directly to Apache on each machine. That is the overview of the environment.
The picture below represents it.


<img src="/images/blog/posts/load-balancer-user-sessions/architecture.png" style="float:right;margin-left:20px;" />

I was struggling for some time to get the right steps to debug the problem.


- environment
- apache
- jvmRoute
- Big F5
- dodawanie informacji o session id