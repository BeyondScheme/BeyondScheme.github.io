---
layout: post
title:  "Welcome to Beyond Scheme blog!"
date:   2016-04-22 16:07:07 +0100
author: "Artur Trzop"
categories: java ruby
tags: news ruby java
---

Welcome on our blog. We are going to publish here technical articles about Java, Ruby and Elixir.

{% highlight ruby %}
# ruby
class Welcome
  def hello(name)
    puts "Hello, #{name}"
  end
end

Welcome.new.hello('Tom')

#=> prints 'Hello, Tom' to STDOUT.
{% endhighlight %}

{% highlight elixir %}
defmodule Welcome do
  @moduledoc """
  Exmaple code in Elixir
  """
  def hello(name) do
    IO.puts "Hello, #{name}"
  end
end

iex> Welcome.hello('Mark')
Hello, Mark
{% endhighlight %}
