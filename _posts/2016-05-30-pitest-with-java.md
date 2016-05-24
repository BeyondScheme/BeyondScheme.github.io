---
layout: post
title:  "Pitest - mutation testing in Java"
date:   2016-05-30 08:00:00 +0200
author: "Tomasz Banaś"
tags: java tests
---

There is no doubt that unit tests are necessary to keep good quality of code. People used to check line coverage to determine if they have good tests, but... Have you ever wondered how to test your tests and check if they really test something?
In this post I'll show you why line coverage is a bad metric and how to use mutation testing in Java.


# Mutation testing
Mutation is a small change in bytecode. When tests will fail then mutation is killed, otherwise mutation has survived.
There are many types of mutation, for example:

* changing operators:

|Original conditional |Mutated conditional|
|:-------------:|:-----:|
|<|<=|
|<=|<|
|>|>=|
|>=|>|

*  removing method calls to void methods,
*  removing all conditionals statements:

{% highlight java %}
if (a == b) {
  // do something
}
{% endhighlight %}

will be mutated to:
{% highlight java %}
if (true) {
  // do something
}
{% endhighlight %}

* changing return values of method calls:

|Return type |Mutation|
|:-------------:|:-----:|
|boolean|change true to false, false to true|
|int byte short|change 0 to 1, otherwise return 0|
|long|change x to x+1|

There are few libraries which can be used to mutation testing. I chose [pitest](http://pitest.org/) library.

# Example of usage pitest in Java
I wrote a small program to calculate ticket price for passengers, which will be used to demonstrate how to use mutation testing in order to create good tests.
Program has two classes, `Passenger` class which represents traveler and `TicketPriceCalculator` which contains logic to calculate ticket price.

{% highlight java %}
# Passenger.java
public class Passenger {

    private int age;

    public Passenger(int age) {
        this.age = age;
    }

    public int getAge() {
        return age;
    }

    public void setAge(int age) {
        this.age = age;
    }

}
{% endhighlight %}

{% highlight java %}
# TicketPriceCalculator.java
public class TicketPriceCalculator {

    private static int ADULT_AGE = 18;
    private static int FREE_TICKET_AGE_BELOW = 3;
    public static double FAMILY_DISCOUNT = 0.05;

    public double calculatePrice(List<Passenger> passengers, int adultTicketPrice, int childTicketPrice) {
        int totalPrice = 0;
        int childrenCounter = 0;
        int adultCounter = 0;
        double result;
        for (Passenger passenger : passengers) {
            if (passenger.getAge() > ADULT_AGE) {
                totalPrice += adultTicketPrice;
                adultCounter++;
            } else if (passenger.getAge() > FREE_TICKET_AGE_BELOW) {
                totalPrice += childTicketPrice;
                childrenCounter++;
            }
        }

        if (childrenCounter > 1 && adultCounter > 1) {
            result = (1 - FAMILY_DISCOUNT) * totalPrice;
        } else {
            result = totalPrice;
        }

        return result;
    }
}
{% endhighlight %}


There are three basic scenarios to cover in tests: ticket for adult, child and family.

{% highlight java %}
# TicketPriceCalculatorTest.java
public class TicketPriceCalculatorTest {

    private static int ADULT_TICKET_PRICE = 40;
    private static int CHILD_TICKER_PRICE = 20;
    private TicketPriceCalculator calculator = new TicketPriceCalculator();

    @Test
    public void calculatePriceForOneAdult() {
        List<Passenger> passengers = new ArrayList<>();
        Passenger passenger = new Passenger(20);
        passengers.add(passenger);
        double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
        assertEquals(ADULT_TICKET_PRICE, price, 0);
    }

    @Test
    public void calculatePriceForChild() {
        List<Passenger> passengers = new ArrayList<>();
        Passenger childPassenger = new Passenger(15);
        passengers.add(childPassenger);
        double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
        assertEquals(CHILD_TICKER_PRICE, price, 0);
    }

    @Test
    public void calculatePriceForFamily() {
        List<Passenger> passengers = new ArrayList<>();
        Passenger adultPassenger1 = new Passenger(20);
        Passenger adultPassenger2 = new Passenger(20);
        Passenger childPassenger3 = new Passenger(12);
        Passenger childPassenger4 = new Passenger(4);
        passengers.add(adultPassenger1);
        passengers.add(adultPassenger2);
        passengers.add(childPassenger3);
        passengers.add(childPassenger4);
        double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
        assertEquals((2 * ADULT_TICKET_PRICE + 2 * CHILD_TICKER_PRICE) *
                (1 - TicketPriceCalculator.FAMILY_DISCOUNT), price, 0);
    }
}
{% endhighlight %}

Ok, let's run pitest to see how good our tests are.

To run pitest we use maven command:
{% highlight plain %}
mvn org.pitest:pitest-maven:mutationCoverage
{% endhighlight %}

It will output an html report to *target/pit-reports/YYYYMMDDHHMI*. In this report we can see that we have 100% line coverage, but only 75% mutation coverage. It means that our tests are not as good as they should be.

<img src="/images/blog/posts/pitest-with-java/lineCoverage.jpg" />

When you click on class name you'll see a detail report.

<img src="/images/blog/posts/pitest-with-java/detailReport.jpg" />

We have one type of mutation which survived, it's conditional boundary change. We already know, that `>` operator is mutated to `>=`. Mutation survived, because when we'll change `>` to `>=` our tests will pass.
We have to add tests for edge cases.

{% highlight java %}
@Test
public void calculatePriceForChildNarrowCase() {
	List<Passenger> passengers = new ArrayList<>();
	Passenger childPassenger = new Passenger(18);
	passengers.add(childPassenger);
	double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
	assertEquals(CHILD_TICKER_PRICE, price, 0);
}

@Test
public void calculatePriceForFreeTicketNarrowCase() {
	List<Passenger> passengers = new ArrayList<>();
	Passenger childPassenger = new Passenger(3);
	passengers.add(childPassenger);
	double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
	assertEquals(0, price, 0);
}

@Test
public void shouldNotCalculatePriceForFamily() {
	List<Passenger> passengers = new ArrayList<>();
	Passenger adultPassenger1 = new Passenger(20);
	Passenger childPassenger2 = new Passenger(12);
	passengers.add(adultPassenger1);
	passengers.add(childPassenger2);
	double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
	assertEquals((ADULT_TICKET_PRICE + CHILD_TICKER_PRICE), price, 0);
}
{% endhighlight %}

Ok, we covered our edge cases, however if you execute pitest plugin once again you'll see that we still have two mutations which survived.

<img src="/images/blog/posts/pitest-with-java/survivedMutations.jpg" />

Take a look into this code:

{% highlight java %}
if (childrenCounter > 1 && adultCounter > 1) {
    result = (1 - FAMILY_DISCOUNT) * totalPrice;
} else {
    result = totalPrice;
}
{% endhighlight %}

Our edge case test scenario passes one adult and one child to this method. Due to AND operator we can change our code to:
{% highlight java %}
if (childrenCounter >= 1 && adultCounter > 1) {
    result = (1 - FAMILY_DISCOUNT) * totalPrice;
} else {
    result = totalPrice;
}
{% endhighlight %}

and all test are still green, because second condition `adultCounter > 1` change the result of this statement to false. The same behaviour we might be observed when we'll change `adultCounter > 1` to `adultCounter >= 1`.
To cover this cases we should replace our `shouldNotCalculatePriceForFamily` with two new tests:
{% highlight java %}
@Test
public void shouldNotCalculatePriceForFamilyEdgeCaseWithAdults() {
	List<Passenger> passengers = new ArrayList<>();
	Passenger adultPassenger1 = new Passenger(20);
	Passenger adultPassenger2 = new Passenger(20);
	Passenger childPassenger1 = new Passenger(12);
	passengers.add(adultPassenger1);
	passengers.add(adultPassenger2);
	passengers.add(childPassenger1);
	double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
	assertEquals((2 * ADULT_TICKET_PRICE + CHILD_TICKER_PRICE), price, 0);
}

@Test
public void shouldNotCalculatePriceForFamilyEdgeCaseWithChildren() {
	List<Passenger> passengers = new ArrayList<>();
	Passenger adultPassenger1 = new Passenger(20);
	Passenger childPassenger1 = new Passenger(12);
	Passenger childPassenger2 = new Passenger(12);
	passengers.add(adultPassenger1);
	passengers.add(childPassenger1);
	passengers.add(childPassenger2);
	double price = calculator.calculatePrice(passengers, ADULT_TICKET_PRICE, CHILD_TICKER_PRICE);
	assertEquals((ADULT_TICKET_PRICE + 2 * CHILD_TICKER_PRICE), price, 0);
}
{% endhighlight %}

After this we finally reached 100% mutation coverage.

# Summary
To sum up, after this reading you should learn how to use mutation testing to see if your tests are good. You also know that line coverage doesn't mean that we have covered all cases. Hope you enjoyed and you'll start to use mutation testing. All code which was used is available on the [repository](https://github.com/BeyondScheme/pitest-java-example).