---
layout: post
title:  "Distributed Game of Life in Elixir"
date:   2016-04-26 22:34:00 +0100
author: "Artur Trzop"
categories: elixir
tags: elixir distributed game
---

I wrote my first game in Elixir. It's a common thing - Game of Life - but it's a bit different when you solve it in a functional language, especially when you can see how actor model works.

__What I'm going to show you is:__

* How to write Elixir simple rules for game of life with tests
* Parallel jobs across actors so we utilize all CPU cores
* How to distribute work across nodes so the game can be executed by many servers in the cluster
* How to use GenServer, TaskSupervisor, Tasks and Agents in Elixir

This is a very simple project and if you find yourself more experience please share your comments how to improve the code described here. Thanks!

# Just intro to Game of Life rules

If you haven't heard about [game of life problem](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life) then here is basic concept. If you already know it, just jump to next header.

The universe of the Game of Life is an infinite two-dimensional orthogonal grid of square cells, each of which is in one of two possible states, alive or dead. Every cell interacts with its eight neighbours, which are the cells that are horizontally, vertically, or diagonally adjacent. At each step in time, the following transitions occur:

* Any live cell with fewer than two live neighbours dies, as if caused by under-population.
* Any live cell with two or three live neighbours lives on to the next generation.
* Any live cell with more than three live neighbours dies, as if by over-population.
* Any dead cell with exactly three live neighbours becomes a live cell, as if by reproduction.

The initial pattern constitutes the seed of the system. The first generation is created by applying the above rules simultaneously to every cell in the seed—births and deaths occur simultaneously, and the discrete moment at which this happens is sometimes called a tick (in other words, each generation is a pure function of the preceding one). The rules continue to be applied repeatedly to create further generations.

# Create new application in Elixir

First thing first so we are going to create a new Elixir OTP application with supervision tree. We will use supervisor for our game server, you will learn more about it a bit later.

{% highlight plain %}
$ mix new --sup game_of_life
{% endhighlight %}

A `--sup` option is given to generate an OTP application skeleton including a supervision tree. Normally an app is generated without a supervisor and without the app callback.

In `lib/game_of_life.ex` file you will find example how to add child worker to supervisor.

{% highlight elixir %}
# lib/game_of_life.ex
defmodule GameOfLife do
  use Application

  # See http://elixir-lang.org/docs/stable/elixir/Application.html
  # for more information on OTP Applications
  def start(_type, _args) do
    import Supervisor.Spec, warn: false

    children = [
      # Define workers and child supervisors to be supervised
      # worker(GameOfLife.Worker, [arg1, arg2, arg3]),
    ]

    # See http://elixir-lang.org/docs/stable/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: GameOfLife.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
{% endhighlight %}

# Represent the board in Game of Life

We need to represent the alive cells on the board in our game. A single cell can be a tuple `{x, y}` with coordinates in the 2-dimensional board.

All alive cells on the board will be in the list `alive_cells`.

{% highlight elixir %}
alive_cells = [{0, 0}, {1, 0}, {2, 0}, {1, 1}, {-1,-2}]
{% endhighlight %}

Here is example how this board with alive cells looks like:

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/board_cells.jpg" />

and here are proper x & y coordinates:

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/board_cells_xy.jpg" />

Now when we have idea how we are going to store our alive cells we can jump to write some code.

# Game of Life rules with tests

We can create `GameOfLife.Cell` module with function `keep_alive?/2` responsitble for determine if particular alive cell `{x, y}` should be still alive on the next generation or not.

Here is the function with expected arguments:

{% highlight elixir %}
# lib/game_of_life/cell.ex
defmodule GameOfLife.Cell do
  def keep_alive?(alive_cells, {x, y} = _alive_cell) do
    # TODO
  end
end
{% endhighlight %}

Let's write some tests to cover first of the requirement of the game of life.

> Any live cell with fewer than two live neighbours dies, as if caused by under-population.

We wrote tests to ensure `GameOfLife.Cell.keep_alive?/2` function returns false in case when alive cell has no neighbours or has just one.

{% highlight elixir %}
# test/game_of_life/cell_test.exs
defmodule GameOfLife.CellTest do
  use ExUnit.Case, async: true

  test "alive cell with no neighbours dies" do
    alive_cell = {1, 1}
    alive_cells = [alive_cell]
    refute GameOfLife.Cell.keep_alive?(alive_cells, alive_cell)
  end

  test "alive cell with 1 neighbour dies" do
    alive_cell = {1, 1}
    alive_cells = [alive_cell, {0, 0}]
    refute GameOfLife.Cell.keep_alive?(alive_cells, alive_cell)
  end
end
{% endhighlight %}

`GameOfLife.Cell.keep_alive?/2` function needs to return false just to pass our tests so let's add more tests to cover other requirements.

> Any live cell with more than three live neighbours dies, as if by over-population.

{% highlight elixir %}
# test/game_of_life/cell_test.exs
test "alive cell with more than 3 neighbours dies" do
  alive_cell = {1, 1}
  alive_cells = [alive_cell, {0, 0}, {1, 0}, {2, 0}, {1, 0}]
  refute GameOfLife.Cell.keep_alive?(alive_cells, alive_cell)
end
{% endhighlight %}

> Any live cell with two or three live neighbours lives on to the next generation.

{% highlight elixir %}
# test/game_of_life/cell_test.exs
test "alive cell with 2 neighbours lives" do
  alive_cell = {1, 1}
  alive_cells = [alive_cell, {0, 0}, {1, 0}]
  assert GameOfLife.Cell.keep_alive?(alive_cells, alive_cell)
end

test "alive cell with 3 neighbours lives" do
  alive_cell = {1, 1}
  alive_cells = [alive_cell, {0, 0}, {1, 0}, {2, 1}]
  assert GameOfLife.Cell.keep_alive?(alive_cells, alive_cell)
end
{% endhighlight %}

Now we can implement our `GameOfLife.Cell.keep_alive?/2` function.

{% highlight elixir %}
# lib/game_of_life/cell.ex
defmodule GameOfLife.Cell do
  def keep_alive?(alive_cells, {x, y} = _alive_cell) do
    case count_neighbours(alive_cells, x, y, 0) do
      2 -> true
      3 -> true
      _ -> false
    end
  end

  defp count_neighbours([head_cell | tail_cells], x, y, count) do
    increment = case head_cell do
      {hx, hy} when hx == x - 1 and hy == y - 1 -> 1
      {hx, hy} when hx == x     and hy == y - 1 -> 1
      {hx, hy} when hx == x + 1 and hy == y - 1 -> 1

      {hx, hy} when hx == x - 1 and hy == y     -> 1
      {hx, hy} when hx == x + 1 and hy == y     -> 1

      {hx, hy} when hx == x - 1 and hy == y + 1 -> 1
      {hx, hy} when hx == x     and hy == y + 1 -> 1
      {hx, hy} when hx == x + 1 and hy == y + 1 -> 1

      _not_neighbour -> 0
    end
    count_neighbours(tail_cells, x, y, count + increment)
  end

  defp count_neighbours([], _x, _y, count), do: count
end
{% endhighlight %}

As you can see we implemented private function `count_neighbours/4` responsible for counting neighbours. It will be helpful later.

There is one more requirement we forogot which is:

> Any dead cell with exactly three live neighbours becomes a live cell, as if by reproduction.

We are going to write a new function `GameOfLife.Cell.become_alive?/2` expecting coordinates of dead cell and returning if the dead cell should become alive or not.

{% highlight elixir %}
# lib/game_of_life/cell.ex
defmodule GameOfLife.Cell do
  def become_alive?(alive_cells, {x, y} = _dead_cell) do
    3 == count_neighbours(alive_cells, x, y, 0)
  end
end
{% endhighlight %}

And here is test for that:

{% highlight elixir %}
# test/game_of_life/cell_test.exs
test "dead cell with three live neighbours becomes a live cell" do
  alive_cells = [{2, 2}, {1, 0}, {2, 1}]
  dead_cell = {1, 1}
  assert GameOfLife.Cell.become_alive?(alive_cells, dead_cell)
end

test "dead cell with two live neighbours stays dead" do
  alive_cells = [{2, 2}, {1, 0}]
  dead_cell = {1, 1}
  refute GameOfLife.Cell.become_alive?(alive_cells, dead_cell)
end
{% endhighlight %}

There is one more thing which might be helpful for us. We have the list of alive cells but we don't know much about dead cells. The number of dead cells is infinity so we need to cut down for which dead cells we want to check if they should become alive. The simple way would be to check only dead cells with alive neighbours. Hence the `GameOfLife.Cell.dead_neighbours/1` function.

Let's write some tests first:

{% highlight elixir %}
# test/game_of_life/cell_test.exs
test "find dead cells (neighbours of alive cell)" do
  alive_cells = [{1, 1}]
  dead_neighbours = GameOfLife.Cell.dead_neighbours(alive_cells) |> Enum.sort
  expected_dead_neighbours = [
    {0, 0}, {1, 0}, {2, 0},
    {0, 1}, {2, 1},
    {0, 2}, {1, 2}, {2, 2}
  ] |> Enum.sort
  assert dead_neighbours == expected_dead_neighbours
end

test "find dead cells (neighbours of alive cells)" do
  alive_cells = [{1, 1}, {2, 1}]
  dead_neighbours = GameOfLife.Cell.dead_neighbours(alive_cells) |> Enum.sort
  expected_dead_neighbours = [
    {0, 0}, {1, 0}, {2, 0}, {3, 0},
    {0, 1}, {3, 1},
    {0, 2}, {1, 2}, {2, 2}, {3, 2}
  ] |> Enum.sort
  assert dead_neighbours == expected_dead_neighbours
end
{% endhighlight %}

and here is the implemented function:

{% highlight elixir %}
# lib/game_of_life/cell.ex
def dead_neighbours(alive_cells) do
  neighbours = neighbours(alive_cells, [])
  (neighbours |> Enum.uniq) -- alive_cells
end

defp neighbours([{x, y} | cells], neighbours) do
  neighbours(cells, neighbours ++ [
    {x - 1, y - 1}, {x    , y - 1}, {x + 1, y - 1},
    {x - 1, y    }, {x + 1, y    },
    {x - 1, y + 1}, {x    , y + 1}, {x + 1, y + 1}
  ])
end

defp neighbours([], neighbours), do: neighbours
{% endhighlight %}

Basically, those are all rules implemented in the single module `GameOfLife.Cell`. You can see the whole [module file](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/lib/game_of_life/cell.ex) with [tests on GitHub](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/test/game_of_life/cell_test.exs).
