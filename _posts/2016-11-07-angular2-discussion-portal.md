---
layout: post
title:  "Angular 2 application with refreshing data in real time"
date:   2016-11-07 08:00:00 +0200
author: "Tomasz Banaś"
tags: angular angular2 gulpjs tslint rxjs
---

Angular 2 was released in October this year. On the Internet you can find more and more tutorials which shows how to build a simple application. This tutorial is quite different from them. It shows how to build an Angular 2 application where we're going to focus on architecture which will periodically pull data from backend to keep fresh data on UI.

__After this tutorial you will know:__

* how to set up Angular 2 project (using GulpJS + TSlint) and build discussion portal,
* how to build a proper architecture (using Angular 2 + RxJs),
* how to create components which will periodically pull date from backend,

Let's start with watching a quick demo how this project works.
<img src="/images/blog/posts/angular2-discussion-portal/demo.gif"/>

# 1. Set up project

The whole project is available on [github](https://github.com/BeyondScheme/angular2-discussion-portal). Please follow instructions written in a [README](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/README.md) file to run the project. 

What we are going to use while building project:

* lite-server - server which we will use to run the project,
* json-server - it is needed for simple db with restful api (we'll share data between each app instance so that's why I didn't choose `angular-in-memory-web-api`),
* GulpJS - tool to build our application,
* TSlint - checkstyle for typescript. I strongly recommend to use this tool - it will fail a build when some checkstyle rules will be violated.

The project contains a few configuration files like:
 
1. `bs-config.json` Configuration file for lite-server. `ghost-mode` flag disabled synchronization of browsers and files. We're going to test our application on two instances so synchronization should be disabled.
2. `db.json` Our database. This file is used by json-server.
3. `gulfile.js` Config file for GulpJS. We have three tasks:
    * `watch` - monitoring files changes and rebuilding if necessary,
    * `tslint, build-ts, build-css` - tasks for running TSlint, building typescripts and css files,
4. `package.json` Contains npm dependencies for project.
5. `systemjs.config.js` Provides information to a module loader about where to find application modules, and registers all the necessary packages.
6. `tsconfig.json` Defines how the TypeScript compiler generates JavaScript from the project's files.
7. `tslint.json` Contains checkstyle rules for TSlint.
8. `typings\globals\es6-shim\index.d.ts` Typings needed by typescript.

# 2. Architecture

<img src="/images/blog/posts/angular2-discussion-portal/architecture.png"/>

As you can see on image we have two components:

#### [_DashboardComponent_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/dashboard/components/dashboard.component.ts)
This component is responsible for displaying existing posts and an input for creating new one. Data for this component is provided by [_PostService_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/shared/services/post.service.ts).

#### [_PostComponent_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/post/components/post.component.ts)
Displaying comments created under a particular post. Data for this component is provided by two services: [_PostService_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/shared/services/post.service.ts) and [_CommentService_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/post/services/comment.service.ts).
[_PostService_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/ts/shared/services/post.service.ts) load post information based on the post id which is url parameter:

{% highlight typescript %}
this.route.params.forEach((params: Params) => {
    if (params[PostComponent.ID_ROUTE_PARAM] !== undefined) {
        let id: number = +params[PostComponent.ID_ROUTE_PARAM];
        this.postService.getPost(id).subscribe(post => {
            this.post = post;
            this.refreshData();
        });
    } else {
        this.router.navigate(["/dashboard"]);
    }
});
{% endhighlight %}

### Pulling data periodically
After loading post we run function `refreshData()` which is worth wider description.
{% highlight typescript %}
private refreshData(): void {
    this.commentsSubscription = this.commentService.getComments(this.post.id).subscribe(comments => {
        this.comments = comments;
        this.subscribeToData();
    });
}

private subscribeToData(): void {
    this.timerSubscription = Observable.timer(5000).first().subscribe(() => this.refreshData());
}
{% endhighlight %}

This function is responsible for refreshing comments in real time. When someone add a new comment everyone who is reading this post will see it without need for refreshing page.

Firstly, we invoke `commentService.getComments(id: number)` to retrieve comments from the backend. On each success call we run `subscribeToData()` which after 5s invoke once again `refreshData()`.
It ensures that data on UI is constantly refresh.

You may wonder why we invoke `subscribeToData()` after successful call instead of adding in `ngOnInit()` method:
{% highlight typescript %}
this.timerSubscription = Observable.timer(5000).subscribe(() => this.refreshData());
{% endhighlight %}

This code call `refreshData()` after every 5s. The problem occurs when on backend side processing a request takes more than 5s. Then the new request (send after 5s) will begin to queue leading to clogging server.
Invoking `refreshData()` after successful call pretends such behaviour. We have certainty that only one request in time is sent to a backend service.

The same architecture is used in `DashboardComponent` for refreshing dashboard data (all available posts):

{% highlight typescript %}
private refreshData(): void {
    this.postsSubscription = this.postService.getPosts().subscribe(posts => {
        this.posts = posts;
        this.subscribeToData();
    });
}

private subscribeToData(): void {
    this.timerSubscription = Observable.timer(5000).first().subscribe(() => this.refreshData());
}
{% endhighlight %}

Remember that you should unsubscribe from all subscriptions in `ngOnDestroy()` method to prevent memory leaks.

{% highlight typescript %}
public ngOnDestroy(): void {
    if (this.postsSubscription) {
        this.postsSubscription.unsubscribe();
    }
    if (this.timerSubscription) {
        this.timerSubscription.unsubscribe();
    }
}
{% endhighlight %}

### 3. Directories structure
While writing first application in Angular 2 I was wondering what is the best practise for files structure in the repository. During working with Angular 2 I worked out structure which is simple and easy to maintain while adding new functionalities.

<img src="/images/blog/posts/angular2-discussion-portal/packages_structure.png"/>

I have three main directories: 

* html - to keep all html files, divided by pages and components. When the new component on dashboard is created new file is added to `html\dashboard`.
* scss - all scss files. Divided only by pages. Main file [_app.scss_](https://github.com/BeyondScheme/angular2-discussion-portal/blob/master/src/scss/app.scss) imports all others scss files.
* ts - typescripts files, divided by pages and type of classes (components/services/models). I also have `shared` directory which contains all code shared between different pages.


### Sum  up
Nowadays frontend code is usually a separate application which communicates with backend. It is necessary to keep this code clean and easy to maintain. When you think about architecture - think not only about backend side, but also about frontend. If you want to refresh data on UI in real time, above architecture is worth considering.

There is also possibility to use publish/subscribe architecture by integrating Angular 2 with [Meteor framework](https://www.meteor.com/), but you have to remember that in this solution your server needs to support WebSockets.

