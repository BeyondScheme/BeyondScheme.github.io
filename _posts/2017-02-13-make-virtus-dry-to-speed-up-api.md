---
layout: post
title:  "Make virtus dry to speed up API"
date:   2017-02-13 08:00:00 +0200
author: "Artur Trzop"
tags: ruby virtus dry-rb
---

[Virtus](https://github.com/solnic/virtus) is a popular ruby gem described as attributes on steroids for plain old ruby objects. I saw it being used in many API applications so
when I was building API for my app I chose the virtus too. Over a year ago the [virtus gem was abandoned by its creator](https://www.reddit.com/r/ruby/comments/3sjb24/virtus_to_be_abandoned_by_its_creator/). A new set of libraries become alternative for virtus - [dry-rb](http://dry-rb.org) - a collection of next-generation Ruby libraries. One of the [virtus problems was performance](https://github.com/solnic/virtus/issues/287) and this article will be about it.

<img src="/images/blog/posts/make-virtus-dry-to-speed-up-api/dry-virtus.jpg" style="float:right;margin-left:20px;width:400px;" alt="dry virtus" />

# Virtus performance issues

In 2015 I started building API for my gem knapsack_pro in order to [optimize test suite split across many CI nodes](https://knapsackpro.com). Recently I started seeing some significant difference with API performance for large users' test suites. The API response took ~500ms and sometimes event much more.

I analyzed logs with [request-log-analyzer](https://github.com/wvanbergen/request-log-analyzer) for one of the days with higher traffic and results were this:

{% highlight plain %}
                                             ┃   Mean ┃ StdDev ┃    Min ┃    Max ┃    95 %tile
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API::V1::BuildDistributionsController#subset ┃  219ms ┃  158ms ┃    0ms ┃  612ms ┃  16ms-529ms
{% endhighlight %}

I did code profiling of the controller action with the [ruby-prof gem](https://github.com/ruby-prof/ruby-prof) and it turned out that half of the time is spent in virtus gem. Why was it a problem in my case?

The [knapsack_pro gem](https://knapsackpro.com) sends information about test files to API and on the API side the each test file is a separate virtus object. So when someone has large test suite then the API slows down.

# Virtus with array of many value objects

Here is the example how I represent the test files in my codebase. Basically, I have a `Node` which is one of the CI nodes where is part of test suite executed. The `Node` has many test files as [value objects](https://en.wikipedia.org/wiki/Value_object).

{% highlight ruby %}
class ValueObject
  include Virtus.value_object
end

class TestFileValue < ValueObject
  values do
    attribute :path, String
    attribute :time_execution, Float
  end
end

class NodeValue < ValueObject
  values do
    attribute :node_index, Integer
    # here is the performance problem when there is too many test files
    attribute :test_files, Array[TestFileValue]
  end
end
{% endhighlight %}

# What are options to improve speed?

I was wondering about a reasonable solution for my virtus performance issue. One of it that occurred was to switch to dry-rb but it would require more work to adjust the whole codebase to it. I decided to try to replace virtus value objects with [dry-struct](http://dry-rb.org/gems/dry-struct/) which is a gem built on top of [dry-types](http://dry-rb.org/gems/dry-types/) which provides virtus-like DSL for defining typed struct classes. One of nice virtus feature was input parameter sanitization and coercion. Dry-types would provide that as well.

# Start with tests

I had two options. Try to add dry-struct to my codebase right away and check whether my test suite project still passes or play a bit with virtus and dry libs and write tests for a few cases I'm most interested about to cover.

I wrote an example of `NodeWithVirtusValueObject` value object with many `VirtusItem` items similar to my `Node` class.

{% highlight ruby %}
# lib/node.rb
class VirtusItem
  include Virtus.value_object

  values do
    attribute :name, String
    attribute :value, Float
  end
end

class NodeWithVirtusValueObject
  include Virtus.model

  attribute :name, String
  attribute :items, Array[VirtusItem]
end
{% endhighlight %}

I added tests to cover cases when hash items are coerced into `VirtusItem`. There is also the example when the `nil` is passed as items or when the `{}` is passed. `{}` is for a case when postgres items field has json type.

{% highlight ruby %}
# spec/node_spec.rb
shared_examples_for 'node' do
  let(:item_1) { item_class.new(name: 'Item A', value: 1.1) }
  # missing value to ensure the value is optional
  let(:item_2) { item_class.new(name: 'Item B') }
  let(:items) { [item_1, item_2] }

  let(:node) do
    node_class.new(
      name: 'Node Name',
      # we pass hash here for items to ensure it will be coerced
      items: items.map(&:to_h)
    )
  end

  it { expect(node).to be_kind_of node_class }
  it { expect(node.name).to eq 'Node Name' }
  it { expect(node.items.size).to be 2 }

  it { expect(node.items[0]).to be_kind_of item_class }
  it { expect(node.items[1]).to be_kind_of item_class }

  it { expect(node.items[0].name).to eq 'Item A' }
  it { expect(node.items[1].name).to eq 'Item B' }

  it { expect(node.items[0].value).to eq 1.1 }
  it { expect(node.items[1].value).to be_nil }

  context 'when items=nil' do
    let(:node) do
      node_class.new(
        name: 'Node Name',
        items: nil
      )
    end

    it { expect(node).to be_kind_of node_class }
    it { expect(node.name).to eq 'Node Name' }
    it { expect(node.items).to eq [] }
  end

  context 'when items={} are empty postgres json field' do
    let(:node) do
      node_class.new(
        name: 'Node Name',
        items: {}
      )
    end

    it { expect(node).to be_kind_of node_class }
    it { expect(node.name).to eq 'Node Name' }
    it { expect(node.items).to eq [] }
  end
end

describe 'Node' do
  context 'when virtus model with value objects in items' do
    let(:node_class) { NodeWithVirtusValueObject }
    let(:item_class) { VirtusItem }

    it_behaves_like 'node'
  end
end
{% endhighlight %}

Now when I had basic test coverage I could add dry libs.


{% highlight ruby %}
# lib/node.rb
module Types
  include Dry::Types.module
end

class DryItem < Dry::Struct
  constructor_type(:schema)

  attribute :name, Types::Strict::String
  attribute :value, Types::Strict::Float.optional
end

class ArrayDryItem < Virtus::Attribute
  def coerce(value)
    case value
    when Array
      value.map do |item|
        coerce_item(item)
      end
    when nil, {}
      []
    else
      raise "Unknow value type: #{value.inspect}"
    end
  end

  private

  def coerce_item(value)
    case value.class.to_s
    when 'Hash'
      DryItem.new(value)
    when 'DryItem'
      value
    else
      raise "Unknow value type: #{value.inspect}"
    end
  end
end

class NodeWithDryStruct
  include Virtus.model

  attribute :name, String
  attribute :items, ArrayDryItem
end
{% endhighlight %}

A few tests to run our test suite against dry libs code:

{% highlight ruby %}
# spec/node_spec.rb
describe 'Node' do
  # ...

  context 'when virtus model with dry struct in items' do
    let(:node_class) { NodeWithDryStruct }
    let(:item_class) { DryItem }

    it_behaves_like 'node'
  end
end
{% endhighlight %}

<img src="/images/blog/posts/make-virtus-dry-to-speed-up-api/dry-rb.jpg" style="float:right;margin-left:20px;width:200px;" alt="dry-rb" />

# Virtus and dry virtus performance

Now it's time to compare the performance of both solutions in different scenarios:

* with single hash as items
* with object as items
* with many hashes as items

Here is the code to track performance:

{% highlight ruby %}
# lib/node_performance.rb
time_me = ->(proc) {
  start_time = Time.now.to_f
  proc.call()
  end_time = Time.now.to_f
  time_in_millis = ((end_time - start_time) * 1000).to_i
  puts time_in_millis
}

NODE_CREATE_LIMIT = 10_000
HASH_ITEMS_LIMIT = 100
NODE_WITH_MANY_ITEMS_CREATE_LIMIT = 100


hash_items = []
HASH_ITEMS_LIMIT.times { hash_items << {name: 'A', value: 1.1} }


puts 'Init NodeWithVirtusValueObject with hash as items'
time_me.call -> {
  NODE_CREATE_LIMIT.times {
    NodeWithVirtusValueObject.new(name: 'Name', items: [{name: 'A', value: 1.1}])
  }
}

puts 'Init NodeWithVirtusValueObject with VirtusItem object as items'
time_me.call -> {
  NODE_CREATE_LIMIT.times {
    NodeWithVirtusValueObject.new(name: 'Name', items: [VirtusItem.new(name: 'A', value: 1.1)])
  }
}

puts 'Init NodeWithVirtusValueObject with many hashes as items'
time_me.call -> {
  NODE_WITH_MANY_ITEMS_CREATE_LIMIT.times {
    NodeWithVirtusValueObject.new(name: 'Name', items: hash_items)
  }
}

puts '-'*20

puts 'Init NodeWithDryStruct with hash as items'
time_me.call -> {
  NODE_CREATE_LIMIT.times {
    NodeWithDryStruct.new(name: 'Name', items: [{name: 'A', value: 1.1}])
  }
}

puts 'Init NodeWithDryStruct with DryItem object as items'
time_me.call -> {
  NODE_CREATE_LIMIT.times {
    NodeWithDryStruct.new(name: 'Name', items: [DryItem.new(name: 'A', value: 1.1)])
  }
}

puts 'Init NodeWithDryStruct with many hashes as items'
time_me.call -> {
  NODE_WITH_MANY_ITEMS_CREATE_LIMIT.times {
    NodeWithDryStruct.new(name: 'Name', items: hash_items)
  }
}
{% endhighlight %}

And those are results. Numbers are in milliseconds:

{% highlight plain %}
Init NodeWithVirtusValueObject with hash as items
905
Init NodeWithVirtusValueObject with VirtusItem object as items
880
Init NodeWithVirtusValueObject with many hashes as items
719
--------------------
Init NodeWithDryStruct with hash as items
228
Init NodeWithDryStruct with DryItem object as items
220
Init NodeWithDryStruct with many hashes as items
127
{% endhighlight %}

The example with dry-struct lib is ~4 times faster. That looked promising so it was time to put this to production codebase.

You can find the whole [repository with virtus and dry examples](https://github.com/ArturT/virtus-and-dry).

# Dry the production code

I adjusted my application code and also added coercion for action controller params along with symbolizing keys.

{% highlight ruby %}
class ArrayTestFileValue < Virtus::Attribute
  def coerce(value)
    case value
    when Array
      value.map do |item|
        coerce_item(item)
      end
    when nil, {}
      []
    else
      raise "Unknow value type: #{value.inspect}"
    end
  end

  private

  def coerce_item(value)
    case value.class.to_s
    # detect action params and symbolize keys
    when 'Hash', 'ActionController::Parameters'
      TestFileValue.new(value.symbolize_keys)
    when 'TestFileValue'
      value
    else
      raise "Unknow value type: #{value.inspect}"
    end
  end
end
{% endhighlight %}

My new test file value object has coercion thanks to dry-types and custom method attributes that used to be provided by virtus.
There is also defined [constructor type schema](http://dry-rb.org/gems/dry-types/hash-schemas/) that allows omitting attributes in the constructor.

{% highlight ruby %}
class TestFileValue < Dry::Struct
  constructor_type(:schema)

  attribute :path, Types::String.optional
  attribute :time_execution, Types::Coercible::Float.optional

  # add method that used to be provided by virtus
  def attributes
    {
      path: path,
      time_execution: time_execution,
    }
  end
end
{% endhighlight %}

And finally the `NodeValue` uses the `ArrayTestFileValue`.

{% highlight ruby %}
class NodeValue < ValueObject
  values do
    attribute :node_index, Integer
    # use the array of dry test file values
    attribute :test_files, ArrayTestFileValue
  end
end
{% endhighlight %}

# Measure the dry virtus performance on production

I again analyzed the production logs after using virtus with dry libs. As you remember the virtus took half of the request time before.
Here are performance results after dry improvements:

{% highlight plain %}
                                             ┃   Mean ┃ StdDev ┃    Min ┃    Max ┃    95 %tile
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
API::V1::BuildDistributionsController#subset ┃  102ms ┃   65ms ┃    7ms ┃  311ms ┃   9ms-248ms
{% endhighlight %}

The API performance improved twice. I did progress to make API faster.

I recommend to check out the [dry-rb](http://dry-rb.org) and learn more about good stuff there. A while ago I wrote the [article about dry-monads](http://beyondscheme.com/2016/monads-in-recurring-payment-handling) so you may find it interesting too.
