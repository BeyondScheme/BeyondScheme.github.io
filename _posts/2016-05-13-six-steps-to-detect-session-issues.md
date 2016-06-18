---
layout: post
title:  "6 steps to investigate unexpected logouts in your Java web application"
date:   2016-05-13 08:00:00 +0200
author: "Kamil Kubacki"
tags: web java springmvc session session-management
---


I would like to share with you six steps that may help in investigation of problems
related to wrong session management and/or wrong infrastructure configuration for your
web applications, especially Java web applications.

# Introduction
The steps were prepared based on the real experience with finding
out the root cause of unexpected users' logouts in my Spring MVC web application.
Users' claimed that they were being logged out during continuous usage of
application (e.g. during clicking through menu). I was trying to reproduce
those unexpected logouts on my own but it resulted in failure. First idea about
possible cause of logouts led me to thinking that users were logged out due to
exceeded idle timeout available. My assumptions were denied by clients (and by me)
so I started looking for the help in the Internet. I was not able to find a clear
way to deal with those kind of problems so I prepared a plan to figure out the solution.
The plan consists of six steps and this blog post represents it.

# Application and infrastructure (overview)
The application I am writing about is a Spring MVC based app with support
of Spring Security for authentication and authorization management.
The application is deployed into multiple [JBoss AS](http://jbossas.jboss.org/)
instances on multiple machines. Each JBoss instance is balanced by
[Apache HTTP Server](https://httpd.apache.org/) and each of the machines is
balanced by load balancer. To give you better view at the infrastructure
please take a look at the picture below.

<img src="/images/blog/posts/six-steps-to-detect-session-issues/architecture.png" alt="infrastructure" />


# The Six Steps

At this point, you are familiar with technical details regarding application
so it is high time to look into the plan.

# <b>1. Verify your application's configuration.</b>
It is a common think for web application to has ability to configure session management.
The variety of configuration is based on the web framework you decide to use.
As for Spring MVC you can influence session management with ```<session-config>...</session-config>```
tag inside web.xml. One of the first things that I checked during investigation
was session timeout configuration under this tag. Session timeout property is
responsible for invalidating users' sessions if they exceed the defined idle time
on the website. The value of this property is defined in minutes. In my case,
a wrongly configured session timeout, e.g. to 2 minutes, could explain the reason
of unexpected logouts. Unfortunately, it was configured with sufficient timeout value.  
Nevertheless, let's take a look at sample configuration of session timeout configuration.

{% highlight plain %}
<session-config>
    <session-timeout>30</session-timeout>
</session-config>
{% endhighlight %}

As you can see, we set session invalidation of session for 30 minutes.
That means that after 30 minutes of not doing anything on the website,
user's session will be invalidated and any action taken redirects user into
login page. Remember, that if you set session timeout property to value -1,
the session will never be invalidated. This is risky in the meaning of security.

Another configuration worth paying attention to is concurrency control strategy
defined inside Spring Security XML configuration file. With this property
you can set maximum concurrent sessions for a user. A sample configuration
presenting the concurrency control strategy is presented below.
As you can notice, the max-sessions allowed for user is set to 1.
If the max-sessions value is exceeded for logged in user, the application might
invalidate user's session. If that happens the currently logged in user will be
logged out after performing any action on the website.  

{% highlight plain %}
<session-management>
    <concurrency-control
       max-sessions="1"
       expired-url="/sessionExpired" />
  </session-management>
{% endhighlight %}

My application did not have that configuration setup but you should always check
for its existence during investigation of session related issues.

# <b>2. Detect any custom session management mechanisms.</b>
Each application has its own secrets. It might happen that developers implement
mechanisms that influence directly users' sessions behavior. Personally, I saw
applications that explicitly increased session timeout for only one page. On the
other hand, I witnessed apps that performed auto-logout (without action of a user)
after some amount of idle time (e.g. 15 minutes). That kind of mechanism was done
with the help of JavaScript and led to incomprehension between development
team and clients.

Again, my application did not have that kind of mechanisms, yet still
I made myself sure about it during investigation. Do the same and if you find one,
pay a lot of attention to it.

# <b>3. Enhance monitoring session's details.</b>
During investigation of session related issues you need to start monitoring
sessions details. It is needed for having better knowledge about their expiration
time, their flow etc.
That monitoring should contain of information about:

* session's create time,
* session's destroy time,
* session's last accessed time.

Additionally, you should monitor user's behavior on each page of your website
 and be able to match user to session ID. In order to do that start monitoring:

* user's remote address,
* user's details (things that let you uniquely identify users, e.g. username/email).

You can save this data multiple ways, e.g. log it into app's logs
(remember to prepare separate logger so that you do not make your app's logs
a bin) or try to use Google Analytics to store data to.

In Spring MVC app, in order to have ability to log the creation and destroy time
of a session you need to define inside your web.xml a listener which implements
HttpSessionLister. HttpSessionListener makes it possible to gather pretty
relevant information about session details. We are able to get information about:
* session's id,
* session's creation time
* session's last accessed time.

Below you can see a definition of custom listener, HttpSessionVerifier, inside web.xml file.

{% highlight plain %}
<listener>
    <listener-class>com.beyondscheme.session.HttpSessionVerifier</listener-class>
</listener>
{% endhighlight %}

The sample implementation of listener which logs information about session
when it gets created and destroyed might be done like this:

{% highlight plain %}

public class HttpSessionVerifier implements HttpSessionListener {

private final static Logger LOGGER = Logger.getLogger(HttpSessionVerifier.class.getName());

  public void sessionCreated(HttpSessionEvent event) {
      Date sessionCreationTime = new Date(event.getSession().getCreationTime());
      Date sessionLastAccessedTime = new Date(event.getSession().getLastAccessedTime());
      int sessionMaxInactiveInterval = event.getSession().getMaxInactiveInterval();
      LOGGER.warn("Session: " + event.getSession().getId()
          + " createTime: " + sessionCreationTime
          + " lastAccess: " + sessionLastAccessedTime
          + " with maxInactiveInterval: " + sessionMaxInactiveInterval
          + " created.");
  }

  public void sessionDestroyed(HttpSessionEvent event) {
      Date sessionCreationTime = new Date(event.getSession().getCreationTime());
      Date sessionLastAccessedTime = new Date(event.getSession().getLastAccessedTime());
      int sessionMaxInactiveInterval = event.getSession().getMaxInactiveInterval();
      LOGGER.warn("Session: " + event.getSession().getId()
          + " createTime: " + sessionCreationTime
          + " lastAccess: " + sessionLastAccessedTime
          + " with maxInactiveInterval: " + sessionMaxInactiveInterval
          + " destroyed.");
  }
}

{% endhighlight %}

Since we have information about creation and destroy time of a session, we need
to figure out how to match a user to a session id. You can do it easily by
logging user's details from HttpServletRequest class.

{% highlight plain %}

private void extractUserInformation(HttpServletRequest request, String url) {

    String userAddr = request.getRemoteAddr();
    String sessionID = request.getSession().getId();
    Date sessionCreationTime = new Date(request.getSession().getCreationTime());
    Date sessionLastAccessedTime = new Date(request.getSession().getLastAccessedTime());
    int sessionMaxInactiveInterval = request.getSession().getMaxInactiveInterval();

    LOGGER.warn("Page" +
        "; url:" + url +
        "; sessionID:" + sessionID +
        "; created:" + sessionCreationTime +
        "; lastAccessed:" + sessionLastAccessedTime +
        "; inactiveInterval:" + sessionMaxInactiveInterval +
        "; userIp:" + userAddr +
        ";");
}

{% endhighlight %}

After adding this logging functionality I found it easy to monitor more precisely
user's sessions flows. With that implemented, I knew exactly when the session
was created but I didn't know if the destruction of the session was caused manually by
user, by clicking logout button, or it was done by app itself. To fix it,
we need to add logging information to logout functionality. In Spring Security
XML configuration file please look for a line which defines logout success-handler.
This handler allows developers to influence logged out functionality.

Definition inside Spring Security XML configuration file.

{% highlight plain %}
<http ...>
 ...
 <logout success-handler-ref="logoutSuccessHandler"/>
</http>
{% endhighlight %}

We need to create a class, LogoutSuccessHandler, that needs to extend
SimpleUrlLogoutSuccessHandler from Spring Security Web library.
A sample implementation of a class which logs the information about
session id during logout is presented below.

{% highlight plain %}

public class LogoutSuccessHandler extends SimpleUrlLogoutSuccessHandler {

  private final static Logger LOGGER = Logger.getLogger(LogoutSuccessHandler.class.getName());

  @Override
  public void onLogoutSuccess(HttpServletRequest request, HttpServletResponse response,
    Authentication authentication)
      throws IOException, ServletException {

      if (request != null && request.getSession() != null) {
          LOGGER.warn("Logout handler for session= " + request.getSession().getId());
      }

      if (authentication != null) {
          LOGGER.info("User name=" + authentication.getPrincipal());
      }

      super.onLogoutSuccess(request, response, authentication);
  }
}

{% endhighlight %}

Now, you are able to distinguish the information about session's destruction
after successful logout by a user or by logout done by application.
As you may see, saving the information about session is extremely helpful for
analysis of session live time.

# <b>4. Analyze your infrastructure.</b>
The analysis of your infrastructure might be extremely helpful. Let me share
with you the most crucial steps in your infrastructure analysis.

1. Prepare the whole overview of your infrastructure.
You have to know what is the exact path of request that is send from user's
browser to your application deployed on application server. In order to do that,
try to draw a whole diagram of your infrastructure.

2. Application Server.
It does not matter which application server you use, get to know if it has an
influence on your session management.

3. Load balancer.
Load balancer is a tricky tool. It is fully responsible for dividing the requests
into different machines. However, wrongly configured may lead to
uncommon problems. After the analysis of your load balancer's configuration ask
yourself two questions:
* how is session persistence configured?
* how do the requests know which box should be chosen for request?

During investigation of mine issue the overview of infrastructure led me to pay
more attention to connection between JBoss instances and Apache. However, the most
significant discovery was the wrong configuration of session persistence on my
load balancer. Unfortunately, that was not the reason of unexpected logouts but
it also had an influence on keeping session to each machine alive for users.

# <b>5. Prepare automatic tests.</b>
Automation is your friend, keep it in mind. I found it impossible to repeat the
unexpected logouts on my own, yet still users had a problem. The only option that
was left to repeat the problem was to prepare automatic
[Selenium](http://www.seleniumhq.org/) based test. The idea behind the test was
simple - perform actions on the website until the test receives logout. That sort
of test combined with proper users' activity monitoring, helps a lot in debugging
the issue.

I would like to share with you couple of rules that should be followed for tests
like that:

* Choose one user for the test.
* Choose exact pages to perform actions on.
* Choose exact actions that will be performed (e.g. edit a form).
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
The five steps presented above allow us to retrieve significant information regarding
session management, users' behavior flows on the website, application's and
infrastructure's configuration.

As for my case, those steps helped in finding the cause of the issue and fixing it.
In the result, the problem laid in load balancer's behavior that was not targeting
responses to proper machines and instances from which it received requests.
As you can imagine, if user was logged into 'Machine 1' and performing action
(e.g. submitting form) load balancer was choosing the random machines to send
a response to. This was caused by the wrong configuration between application
and load balancer. The problem with detection this issue was caused by the fact
that in the 80% of cases the load balancer worked just fine.

How can you fix issue like that?

In my case, load balancer offered a way to explicitly inform it about request's
details such as the instance that the request was coming from. Let me share with
you my solution.

I had to configure each JBoss instance so that it had unique identifier.
To do that, I setup unique "jvmRoute" parameter in JBoss and properly
configured Apache's workers to match "jvmRoute" name.

As for "jvmRoute" parameter, please find a directory
```${JBOSS_PATH}/server/default/deploy/jboss-web.deployer/``` and look
for a file server.xml. Inside this file, look for a tag
```<Engine> ... </Engine>``` and set attribute "jvmRoute" so that it uniquely
identifies your instance. Sample definition of "jvmRoute" attribute.

{% highlight plain %}
<Engine name="jboss.web" defaultHost="localhost" jvmRoute="uniqueJvmRouteName">
...
</Engine>
{% endhighlight %}

Then, you need to configure Apache's workers. Apache's workers configuration is
located under ```${APACHE_PATH}/conf``` folder inside workers.properties file.
Define worker to match "jvmRoute" name. Sample definition of worker.

{% highlight plain %}
worker.uniqueJvmRouteName.reference=worker.node
worker.uniqueJvmRouteName.port=0000
{% endhighlight %}

That information about unique "jvmRoute" parameter should be shared with load
balancer. You need to explicitly configure your load balancer to recognize if
the requests contain that information. As for Java based application, that configuration
you might add unique instance name to JSESSION_ID cookie. This cookie might be analyzed by load balancer
to know from which machine/instance the request came from.

Summing up all the steps and their results, verification of application's
configuration allowed me to abandon focusing on wrong behavior of session
management INSIDE the application. Thanks to the increased logging, I was able
to easily track users and their flows on each instance of the application. Moreover,
logging and automatic test allowed me to confirm that users' requests
were unexpectedly "jumping" from one instance to another. Due to verification of the
infrastructure I found some possible weaknesses that pushed me to check
carefully Apache's and load balancer's configuration. At last but not least,
the automatic test that was running repeatedly for a couple of days,
at first helped to confirm users' report and detect the issue. Secondly, it was
also responsible for verification of the fix.

# Summary
This is the end of the blog post. After this reading, you should be able to have
a better overview how to deal with tricky cases regarding detection of unexpected
users' logouts in or any other session management issues your web applications.
I hope that it might help you, as performing those steps helped me.
If you have any thoughts or questions, please share them in the comments.
