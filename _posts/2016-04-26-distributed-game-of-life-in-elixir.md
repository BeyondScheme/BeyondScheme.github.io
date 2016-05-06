---
layout: post
title:  "Distributed Game of Life in Elixir"
date:   2016-04-26 22:34:00 +0100
author: "Artur Trzop"
categories: elixir
tags: elixir distributed game
---

I wrote my first game in Elixir. It is a popular thing - Conway's Game of Life - but it gets quite interesting when you solve it in a functional language, especially when you can see [how actor model works](https://en.wikipedia.org/wiki/Actor_model) and how actors are distributed across servers in network.

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/game_of_life_logo.png" style="float:right;margin-left:20px;" />

__In this blog post I am going to show:__

* how to write rules for game of life with tests in Elixir,
* parallel tasks across lightweight processes (actors) in order to utilize all CPU cores,
* how to distribute work across nodes so the game can be executed by many servers in the cluster,
* how to use GenServer behaviour, TaskSupervisor and Agents in Elixir.

This project and the full [source code can be found here](https://github.com/BeyondScheme/elixir-game_of_life).

# Demo

Let's start with watching quick demo how the game works.

<script type="text/javascript" src="https://asciinema.org/a/44233.js" id="asciicast-44233" async data-preload="true"></script>

As you can see, node1 represents running game and board on the screen. The second node was also started and connected to the first one. From the second node, we added new cells to the board. Both nodes are responsible for processing the game, but only the first node is a master with information about the current state of the game. We can connect more nodes to the cluster so game processing can happen on all of the nodes. You are going to learn in this article how to make it happen.

# Game of Life rules

If you already know about [the game of life problem](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life) just jump to [the next header](#create-new-application-in-elixir). If not, in this chapter you can learn a basic concept.

The universe of the Game of Life is an infinite two-dimensional orthogonal grid of square cells, each of which is in one of two possible states, alive or dead. Every cell interacts with its eight neighbours, which are the cells that are horizontally, vertically, or diagonally adjacent. At each step in time, the following transitions occur:

* Any live cell with fewer than two live neighbours dies, as if caused by under-population.
* Any live cell with two or three live neighbours lives on to the next generation.
* Any live cell with more than three live neighbours dies, as if by over-population.
* Any dead cell with exactly three live neighbours becomes a live cell, as if by reproduction.

The initial pattern constitutes the seed of the system. The first generation is created by applying the above rules simultaneously to every cell in the seed—births and deaths occur simultaneously, and the discrete moment at which this happens is sometimes called a tick (in other words, each generation is a pure function of the preceding one). The rules continue to be applied repeatedly to create further generations.

# Create new application in Elixir

First things first, so we are going to create a new Elixir OTP application with supervision tree. We will use supervisor for our game server, you will learn more about it a bit later.

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

Here is an example how this board with alive cells looks like:

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/board_cells.jpg" />

and here are proper x & y coordinates:

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/board_cells_xy.jpg" />

Now when we have the idea how we are going to store our alive cells we can jump to write some code.

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

Let's write some tests to cover first of the requirement of the Game of Life:

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

Now, we can implement our `GameOfLife.Cell.keep_alive?/2` function.

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

As you can see, we implemented private function `count_neighbours/4` responsible for counting neighbours. It will be helpful to meet the next rule.

There is one more requirement we forogot about:

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

Basically, these are all rules implemented in the single module `GameOfLife.Cell`. You can see the whole [module file](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/lib/game_of_life/cell.ex) with [tests on GitHub](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/test/game_of_life/cell_test.exs).

# Architecture of distributed Game of Life

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/supervisor.jpg" />

Our main supervisor is `GameOfLife.Supervisor` which I mentioned at the begining of the article. Below you can see how we defined its children like `Task.Supervisor`, workers for `BoardServer` and `GamePrinter`.

{% highlight elixir %}
# lib/game_of_life.ex
defmodule GameOfLife do
  use Application

  # See http://elixir-lang.org/docs/stable/elixir/Application.html
  # for more information on OTP Applications
  def start(_type, _args) do
    import Supervisor.Spec, warn: false

    init_alive_cells = []

    children = [
      # Define workers and child supervisors to be supervised
      # worker(GameOfLife.Worker, [arg1, arg2, arg3]),
      supervisor(Task.Supervisor, [[name: GameOfLife.TaskSupervisor]]),
      worker(GameOfLife.BoardServer, [init_alive_cells]),
      worker(GameOfLife.GamePrinter, []),
    ]

    # See http://elixir-lang.org/docs/stable/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: GameOfLife.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
{% endhighlight %}

Let me describe what each component on the image is responsible for.

* `Task.Supervisor` is Elixir module defining a new supervisor which can be used to dynamically supervise tasks. We are going to use it to spin off tasks like determining if the particular cell should live or die. Those tasks can be run across nodes connected into the cluster. In above code, we gave name `GameOfLife.TaskSupervisor` for our supervisor. We will use this name to tell `Task.Supervisor.async` function which Task Supervisor should handle our task. You can read more about [Task.Supervisor here](http://elixir-lang.org/docs/stable/elixir/Task.Supervisor.html).

* `GameOfLife.BoardServer` is our module implemented as [GenServer behaviour](http://elixir-lang.org/docs/stable/elixir/GenServer.html). It is responsible for holding the state of the game. By that I mean it keeps the list of alive cells on the board along with generation counter and TRef. TRef is a timer reference returned by [Erlang timer module](http://erlang.org/doc/man/timer.html) and [apply_interval](http://erlang.org/doc/man/timer.html#apply_interval-4) function. We want to start the game and generate a new list of alive cells for next generation with specified time interval. With each new generation, we will update generation counter. The other interesting thing is that `GameOfLife.BoardServer` is running only on a single node. Once another node is connected to the cluster where is already running `GameOfLife.BoardServer` then `GameOfLife.BoardServer` won't be started just like that on the newly connected node. Instead on the new node `GameOfLife.BoardServer` will keep the only reference to the PID of the process existing on the first node. We want to have the single source of truth about the state of our game in one master `GameOfLife.BoardServer` process existing on the first node started in the cluster.

* `GameOfLife.GamePrinter` is a simple module using [Agent](http://elixir-lang.org/docs/stable/elixir/Agent.html) in order to keep TRef (time reference) so we can print board to STDOUT with the specified interval. We will use [Erlang timer module](http://erlang.org/doc/man/timer.html#apply_interval-4) to print board on the screen every second.

You may wonder what's the difference between GenServer and Agent.

A GenServer is a process like any other Elixir process and it can be used to keep state, execute code asynchronously and so on. The advantage of using a generic server process (GenServer) is that it will have a standard set of interface functions and include functionality for tracing and error reporting. It also fits into a supervision tree as this is what we did in `GameOfLife` module.

On the other hand, Agent is much simpler solution than GenServer. Agents are a simple abstraction around state.
Often in Elixir there is a need to share or store state that must be accessed from different processes or by the same process at different points in time. The Agent module provides a basic server implementation that allows state to be retrieved and updated via a simple API.
This is what we are going to do in `GameOfLife.GamePrinter` as we only need to keep time reference to our timer interval.

# Create BoardServer

Let's start with creating `GameOfLife.BoardServer` generic server behaviour. We define public interface for the server.

{% highlight elixir %}
# lib/game_of_life/board_server.ex
defmodule GameOfLife.BoardServer do
  use GenServer
  require Logger

  @name {:global, __MODULE__}

  @game_speed 1000 # miliseconds

  # Client

  def start_link(alive_cells) do
    case GenServer.start_link(__MODULE__, {alive_cells, nil, 0}, name: @name) do
      {:ok, pid} ->
        Logger.info "Started #{__MODULE__} master"
        {:ok, pid}
      {:error, {:already_started, pid}} ->
        Logger.info "Started #{__MODULE__} slave"
        {:ok, pid}
    end
  end

  def alive_cells do
    GenServer.call(@name, :alive_cells)
  end

  def generation_counter do
    GenServer.call(@name, :generation_counter)
  end

  def state do
    GenServer.call(@name, :state)
  end

  @doc """
  Clears board and adds only new cells.
  Generation counter is reset.
  """
  def set_alive_cells(cells) do
    GenServer.call(@name, {:set_alive_cells, cells})
  end

  def add_cells(cells) do
    GenServer.call(@name, {:add_cells, cells})
  end

  def tick do
    GenServer.cast(@name, :tick)
  end

  def start_game(speed \\ @game_speed) do
    GenServer.call(@name, {:start_game, speed})
  end

  def stop_game do
    GenServer.call(@name, :stop_game)
  end

  def change_speed(speed) do
    stop_game
    start_game(speed)
  end
end
{% endhighlight %}

As you can see, we use `GenServer` behaviour in our module. I require also Logger as we would like to print some info to the STDOUT.

In `start_link/1` function we start new `GenServer`. When our generic server was started as a first process in the cluster then it becomes master process. In the case when there is already running process with globally registered name `{:global, __MODULE__}` we log info that our process will be a slave process with a reference to existing PID on another node in the cluster.

As you see we store global name for our server in attribute `@name`. We use another attribute `@game_speed` for default game speed which is 1000 miliseconds.

In our public interface, we have `alive_cells/1` function which returns the list of alive cells. Basically, it is the current state of the game (alive cells on the board). This function calls `GenServer` with registered `@name` and request `:alive_cells`. We need to implement `handle_call/3` function for this type of request (`:alive_cells`).

There is another public function `generation_counter/1` which returns how many generations were already processed by board server.

The `state/1` function returns state that is held by our generic server. The state is represented as the tuple with 3 values like alive cells, TRef (time reference - we want to regenerate board every second) and generation counter. TRef is very internal thing for board server so we won't return this to the outside world. That's why we will return just alive cells and generation counter. You will see it later in the implementation for `handle_call(:state, _from, state)`.

You can use `set_alive_cells/1` function in the case when you want to override current list of alive cells with a new list.

The `add_cells/1` function will be very usefull as we want to be able to add new cells or figures to the board. For instance we may want to add a blinker pattern to existing game. You will learn more about patterns later.

<a href="https://en.wikipedia.org/wiki/File:Game_of_life_blinker.gif"><img src="/images/blog/posts/distributed-game-of-life-in-elixir/blinker.gif" /></a>

We can manually force game to calculate next generation of cells with `tick/1` function.

The `start_game/1` function is responsible for starting a new timer which calls every second a `tick/1` function. Thanks to that our game will update list of alive cells with specified interval which is `@game_speed`.

The last 2 functions are `stop_game/1` and `change_speed/1` which just restart the game and starts a new one with provided speed.

Now you can take a look how above functions are working. They are calling server callbacks.

{% highlight elixir %}
# lib/game_of_life/board_server.ex
defmodule GameOfLife.BoardServer do
  use GenServer
  # ...

  # Server (callbacks)

  def handle_call(:alive_cells, _from, {alive_cells, _tref, _generation_counter} = state) do
    {:reply, alive_cells, state}
  end

  def handle_call(:generation_counter, _from, {_alive_cells, _tref, generation_counter} = state) do
    {:reply, generation_counter, state}
  end

  def handle_call(:state, _from, {alive_cells, _tref, generation_counter} = state) do
    {:reply, {alive_cells, generation_counter}, state}
  end

  def handle_call({:set_alive_cells, cells}, _from, {_alive_cells, tref, _generation_counter}) do
    {:reply, cells, {cells, tref, 0}}
  end

  def handle_call({:add_cells, cells}, _from, {alive_cells, tref, generation_counter}) do
    alive_cells = GameOfLife.Board.add_cells(alive_cells, cells)
    {:reply, alive_cells, {alive_cells, tref, generation_counter}}
  end

  def handle_call({:start_game, speed}, _from, {alive_cells, nil = _tref, generation_counter}) do
    {:ok, tref} = :timer.apply_interval(speed, __MODULE__, :tick, [])
    {:reply, :game_started, {alive_cells, tref, generation_counter}}
  end

  def handle_call({:start_game, _speed}, _from, {_alive_cells, _tref, _generation_counter} = state) do
    {:reply, :game_already_running, state}
  end

  def handle_call(:stop_game, _from, {_alive_cells, nil = _tref, _generation_counter} = state) do
    {:reply, :game_not_running, state}
  end

  def handle_call(:stop_game, _from, {alive_cells, tref, generation_counter}) do
    {:ok, :cancel} = :timer.cancel(tref)
    {:reply, :game_stoped, {alive_cells, nil, generation_counter}}
  end

  def handle_cast(:tick, {alive_cells, tref, generation_counter}) do
    keep_alive_task = Task.Supervisor.async(
                      {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                      GameOfLife.Board, :keep_alive_tick, [alive_cells])
    become_alive_task = Task.Supervisor.async(
                        {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                        GameOfLife.Board, :become_alive_tick, [alive_cells])

    keep_alive_cells = Task.await(keep_alive_task)
    born_cells = Task.await(become_alive_task)

    alive_cells = keep_alive_cells ++ born_cells

    {:noreply, {alive_cells, tref, generation_counter + 1}}
  end
end
{% endhighlight %}

Oh, we forgot about tests. In this case, we can use [DocTest](http://elixir-lang.org/docs/stable/ex_unit/ExUnit.DocTest.html). It allows us to generate tests from the code examples existing in a module/function/macro’s documentation.

Our test file is super short:

{% highlight elixir %}
# test/game_of_life/board_server_test.exs
defmodule GameOfLife.BoardServerTest do
  use ExUnit.Case
  doctest GameOfLife.BoardServer
end
{% endhighlight %}

Let's add `@moduledoc` to `GameOfLife.BoardServer`.

{% highlight elixir %}
# lib/game_of_life/board_server.ex
defmodule GameOfLife.BoardServer do
  use GenServer
  require Logger

  @moduledoc """
  ## Example
      iex> GameOfLife.BoardServer.start_game
      :game_started
      iex> GameOfLife.BoardServer.start_game
      :game_already_running
      iex> GameOfLife.BoardServer.stop_game
      :game_stoped
      iex> GameOfLife.BoardServer.stop_game
      :game_not_running
      iex> GameOfLife.BoardServer.change_speed(500)
      :game_started
      iex> GameOfLife.BoardServer.stop_game
      :game_stoped

      iex> GameOfLife.BoardServer.set_alive_cells([{0, 0}])
      [{0, 0}]
      iex> GameOfLife.BoardServer.alive_cells
      [{0, 0}]
      iex> GameOfLife.BoardServer.add_cells([{0, 1}])
      [{0, 0}, {0, 1}]
      iex> GameOfLife.BoardServer.alive_cells
      [{0, 0}, {0, 1}]
      iex> GameOfLife.BoardServer.state
      {[{0, 0}, {0, 1}], 0}

      iex> GameOfLife.BoardServer.generation_counter
      0
      iex> GameOfLife.BoardServer.tick
      :ok
      iex> GameOfLife.BoardServer.generation_counter
      1
      iex> GameOfLife.BoardServer.state
      {[], 1}
  """
end
{% endhighlight %}

As you can see we have grouped 3 examples in `@moduledoc` attribute and they are separated by new line. When you will run tests you will see 3 separate test.

{% highlight plain %}
$ mix test test/game_of_life/board_server_test.exs
Compiled lib/game_of_life/board_server.ex

20:54:30.637 [info]  Started Elixir.GameOfLife.BoardServer master
...

Finished in 0.1 seconds (0.1s on load, 0.00s on tests)
3 tests, 0 failures

Randomized with seed 791637
{% endhighlight %}

In `GameOfLife.BoardServer` you probably noticed 2 interesting things. First is `GameOfLife.Board` which is called in:

{% highlight elixir %}
# lib/game_of_life/board_server.ex
def handle_call({:add_cells, cells}, _from, {alive_cells, tref, generation_counter}) do
  alive_cells = GameOfLife.Board.add_cells(alive_cells, cells)
  {:reply, alive_cells, {alive_cells, tref, generation_counter}}
end
{% endhighlight %}

We will add some useful functions to `GameOfLife.Board` module which helps us to do operations on the list of alive cells.

Another interesting thing is how we use `Task.Supervisor` in:

{% highlight elixir %}
# lib/game_of_life/board_server.ex
def handle_cast(:tick, {alive_cells, tref, generation_counter}) do
    keep_alive_task = Task.Supervisor.async(
                      {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                      GameOfLife.Board, :keep_alive_tick, [alive_cells])
    become_alive_task = Task.Supervisor.async(
                        {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                        GameOfLife.Board, :become_alive_tick, [alive_cells])

    keep_alive_cells = Task.await(keep_alive_task)
    born_cells = Task.await(become_alive_task)

    alive_cells = keep_alive_cells ++ born_cells

    {:noreply, {alive_cells, tref, generation_counter + 1}}
  end
{% endhighlight %}

What we are doing here is spinning off a new async process to run `GameOfLife.keep_alive_tick/1` function with argument `alive_cells`.

{% highlight elixir %}
# lib/game_of_life/board_server.ex
keep_alive_task = Task.Supervisor.async(
                  {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                  GameOfLife.Board, :keep_alive_tick, [alive_cells])
{% endhighlight %}

The tuple `{GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node}` tells `Task.Supervisor` that we want to use task supervisor with the name `GameOfLife.TaskSupervisor` and we want to run the process on the node returned by `GameOfLife.NodeManager.random_node` function.

# Create node manager for task supervisor

Let's start with something simple just to see if we can distribute work across nodes in the cluster. We assume each new process created by task supervisor will be assigned randomly to one of the connected nodes. Each node should be equally overloaded with the assumption that each task is pretty similar and all nodes are machines with the same configuration and overload.

{% highlight elixir %}
# lib/game_of_life/node_manager.ex
defmodule GameOfLife.NodeManager do
  def all_nodes do
    [Node.self | Node.list]
  end

  def random_node do
    all_nodes |> Enum.random
  end
end
{% endhighlight %}

Our node manager has `random_node/0` function which returns the name of a random node connected to the cluster. Basically, that's it. Simple solution should be enough for now.

# Create board helper functions

We need some helper functions for operations we can do on the board like adding, removing cells. Let's start with tests for module `GameOfLife.Board` and function `add_cells/2`.

{% highlight elixir %}
# test/game_of_life/board_test.exs
defmodule GameOfLife.BoardTest do
  use ExUnit.Case, async: true

  test "add new cells to alive cells without duplicates" do
    alive_cells = [{1, 1}, {2, 2}]
    new_cells = [{0, 0}, {1, 1}]
    actual_alive_cells = GameOfLife.Board.add_cells(alive_cells, new_cells)
                          |> Enum.sort
    expected_alive_cells = [{0, 0}, {1, 1}, {2, 2}]
    assert actual_alive_cells == expected_alive_cells
  end
end
{% endhighlight %}

We need to ensure we won’t allow adding the same cell twice to the board hence we test there are no duplicates. Here is the implementation for `add_cells/2` function:

{% highlight elixir %}
# lib/game_of_life/board.ex
defmodule GameOfLife.Board do
  def add_cells(alive_cells, new_cells) do
    alive_cells ++ new_cells
    |> Enum.uniq
  end
end
{% endhighlight %}

Another thing is removing cells from the list of alive cells:

{% highlight elixir %}
# test/game_of_life/board_test.exs
test "remove cells which must be killed from alive cells" do
  alive_cells = [{1, 1}, {4, -2}, {2, 2}, {2, 1}]
  kill_cells = [{1, 1}, {2, 2}]
  actual_alive_cells = GameOfLife.Board.remove_cells(alive_cells, kill_cells)
  expected_alive_cells = [{4, -2}, {2, 1}]
  assert actual_alive_cells == expected_alive_cells
end
{% endhighlight %}

Implementation is super simple:

{% highlight elixir %}
# lib/game_of_life/board.ex
def remove_cells(alive_cells, kill_cells) do
  alive_cells -- kill_cells
end
{% endhighlight %}

Let's create something more advanced. We should determine which cells should still live on the next generation after tick. Here is test for `GameOfLife.Board.keep_alive_tick/1` function:

{% highlight elixir %}
# test/game_of_life/board_test.exs
test "alive cell with 2 neighbours lives on to the next generation" do
  alive_cells = [{0, 0}, {1, 0}, {2, 0}]
  expected_alive_cells = [{1, 0}]
  assert GameOfLife.Board.keep_alive_tick(alive_cells) == expected_alive_cells
end
{% endhighlight %}

The function `keep_alive_tick` does a few things like creating a new task with `Task.Supervisor` for each alive cell. Tasks will be created across available nodes in the cluster. We calculate if alive cells should stay alive or be removed. `keep_alive_or_nilify/2` function returns the cell if should live or `nil` otherwise. We wait with `Task.await/1` till all tasks across nodes finished they work. Tasks are working in parallel but we need to wait for results from each task. We remove from the list the `nil` values so at the end we end up with only alive cells for the next generation.

{% highlight elixir %}
# lib/game_of_life/board.ex
@doc "Returns cells that should still live on the next generation"
def keep_alive_tick(alive_cells) do
  alive_cells
  |> Enum.map(&(Task.Supervisor.async(
                {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                GameOfLife.Board, :keep_alive_or_nilify, [alive_cells, &1])))
  |> Enum.map(&Task.await/1)
  |> remove_nil_cells
end

def keep_alive_or_nilify(alive_cells, cell) do
  if GameOfLife.Cell.keep_alive?(alive_cells, cell), do: cell, else: nil
end

defp remove_nil_cells(cells) do
  cells
  |> Enum.filter(fn cell -> cell != nil end)
end
{% endhighlight %}

There is one more case we should handle which is situation when dead cells should become alive. `GameOfLife.Board.become_alive_tick/1` function will be responsible for that.

{% highlight elixir %}
# test/game_of_life/board_test.exs
test "dead cell with three live neighbours becomes a live cell" do
  alive_cells = [{0, 0}, {1, 0}, {2, 0}, {1, 1}]
  born_cells = GameOfLife.Board.become_alive_tick(alive_cells)
  expected_born_cells = [{1, -1}, {0, 1}, {2, 1}]
  assert born_cells == expected_born_cells
end
{% endhighlight %}

That's how our function looks like:

{% highlight elixir %}
# lib/game_of_life/board.ex
@doc "Returns new born cells on the next generation"
def become_alive_tick(alive_cells) do
  GameOfLife.Cell.dead_neighbours(alive_cells)
  |> Enum.map(&(Task.Supervisor.async(
                {GameOfLife.TaskSupervisor, GameOfLife.NodeManager.random_node},
                GameOfLife.Board, :become_alive_or_nilify, [alive_cells, &1])))
  |> Enum.map(&Task.await/1)
  |> remove_nil_cells
end

def become_alive_or_nilify(alive_cells, dead_cell) do
  if GameOfLife.Cell.become_alive?(alive_cells, dead_cell), do: dead_cell, else: nil
end
{% endhighlight %}

It works similarly as `GameOfLife.Board.keep_alive_tick/1`. First, we are looking for dead neighbours for alive cells and then for each dead cell we create a new process across nodes in the cluster to determine if the dead cell should become alive in next generation.

You can see the full source code of [GameOfLife.Board module](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/lib/game_of_life/board.ex) and [tests on github](https://github.com/BeyondScheme/elixir-game_of_life/blob/master/test/game_of_life/board_test.exs).

# Create game printer and console presenter

`GameOfLife.GamePrinter` module is running as a worker under supervise of `GameOfLife` supervisor. `GameOfLife.GamePrinter` is using `Agent` to store `TRef` for timer reference as we want to print the board to the STDOUT with the specified interval. You have already seen the example of using `Agent` so this shouldn't be new for you. Basically, we wrote public interface to start and stop printing the board to the screen. For tests we used [DocTest](http://elixir-lang.org/docs/stable/ex_unit/ExUnit.DocTest.html).

{% highlight elixir %}
# lib/game_of_life/game_printer.ex
defmodule GameOfLife.GamePrinter do
  @moduledoc """
  ## Example
      iex> GameOfLife.GamePrinter.start_printing_board
      :printing_started
      iex> GameOfLife.GamePrinter.start_printing_board
      :already_printing
      iex> GameOfLife.GamePrinter.stop_printing_board
      :printing_stopped
      iex> GameOfLife.GamePrinter.stop_printing_board
      :already_stopped
  """

  @print_speed 1000

  def start_link do
    Agent.start_link(fn -> nil end, name: __MODULE__)
  end

  def start_printing_board do
    Agent.get_and_update(__MODULE__, __MODULE__, :do_start_printing_board, [])
  end

  def do_start_printing_board(nil = _tref) do
    {:ok, tref} = :timer.apply_interval(@print_speed, __MODULE__, :print_board, [])
    {:printing_started, tref}
  end

  def do_start_printing_board(tref), do: {:already_printing, tref}

  def print_board do
    {alive_cells, generation_counter} = GameOfLife.BoardServer.state
    alive_counter = alive_cells |> Enum.count
    GameOfLife.Presenters.Console.print(alive_cells, generation_counter, alive_counter)
  end

  def stop_printing_board do
    Agent.get_and_update(__MODULE__, __MODULE__, :do_stop_printing_board, [])
  end

  def do_stop_printing_board(nil = _tref), do: {:already_stopped, nil}

  def do_stop_printing_board(tref) do
    {:ok, :cancel} = :timer.cancel(tref)
    {:printing_stopped, nil}
  end
end
{% endhighlight %}

`GameOfLife.Presenters.Console` is responsible for printing board nicely with  X & Y axises, the number of alive cells and the generation counter.
Let's start with tests. We are going to capture STDOUT and compare if data printed to the screen are looking as we expect.

{% highlight elixir %}
# test/game_of_life/presenters/console_test.exs
defmodule GameOfLife.Presenters.ConsoleTest do
  use ExUnit.Case

  # allows to capture stuff sent to stdout
  import ExUnit.CaptureIO

  test "print cells on the console output" do
    cell_outside_of_board = {-1, -1}
    cells = [{0, 0}, {1, 0}, {2, 0}, {1, 1}, {0, 2}, cell_outside_of_board]

    result = capture_io fn ->
      GameOfLife.Presenters.Console.print(cells, 123, 6, 0, 2, 2, 2)
    end

    assert result == (
    "    2| O,,\n" <>
    "    1| ,O,\n" <>
    "    0| OOO\n" <>
    "     | _ _ \n" <>
    "    /  0    \n" <>
    "Generation: 123\n" <>
    "Alive cells: 6\n"
    )
  end
end
{% endhighlight %}

Here is implemented our print function:

{% highlight elixir %}
# lib/game_of_life/presenters/console.ex
defmodule GameOfLife.Presenters.Console do
  @doc """
  Print cells to the console output.
  Board is visible only for specified size for x and y.
  Start x and y are in top left corner of the board.

  `x_padding` Must be a prime number. Every x divided by the prime number
  will be visible on x axis.
  `y_padding` Any number. Padding for numbers on y axis.
  """
  def print(cells, generation_counter, alive_counter, start_x \\ -10, start_y \\ 15, x_size \\ 60,
            y_size \\ 20, x_padding \\ 5, y_padding \\ 5) do
    end_x = start_x + x_size
    end_y = start_y - y_size
    x_range = start_x..end_x
    y_range = start_y..end_y

    for y <- y_range, x <- x_range do
      # draw y axis
      if x == start_x do
        (y
        |> Integer.to_string
        |> String.rjust(y_padding)) <> "| "
        |> IO.write
      end

      IO.write(if Enum.member?(cells, {x, y}), do: "O", else: ",")
      if x == end_x, do: IO.puts ""
    end

    # draw x axis
    IO.write String.rjust("| ", y_padding + 2)
    x_length = (round((end_x-start_x)/2))
    for x <- 0..x_length, do: IO.write "_ "
    IO.puts ""
    IO.write String.rjust("/  ", y_padding + 2)
    for x <- x_range do
      if rem(x, x_padding) == 0 do
        x
        |> Integer.to_string
        |> String.ljust(x_padding)
        |> IO.write
      end
    end
    IO.puts ""
    IO.puts "Generation: #{generation_counter}"
    IO.puts "Alive cells: #{alive_counter}"
  end
end
{% endhighlight %}

The board with bigger visible part looks like:

{% highlight plain %}
   15| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   14| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   13| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   12| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   11| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   10| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    9| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    8| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    7| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    6| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    5| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    4| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    3| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    2| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    1| ,,,,,,,,,,OO,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
    0| ,,,,,,,,,,OO,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   -1| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   -2| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   -3| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   -4| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
   -5| ,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
     | _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
    /  -10  -5   0    5    10   15   20   25   30   35   40   45   50
Generation: 18
Alive cells: 4
{% endhighlight %}

# Add figure patterns and place them on the board

To play our game of life would be great to have an easy way to add figures on the board. There are many common known patterns like still lifes, oscillators, spaceships. You can [learn more about them here](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life#Examples_of_patterns).

One of interesting kind of patterns is gun. Gosper Glider Gun is very popular pattern. Here it is how it looks:

<a href="https://en.wikipedia.org/wiki/Gun_(cellular_automaton)"><img src="/images/blog/posts/distributed-game-of-life-in-elixir/gospers_glider_gun.svg" /></a>

When you run game the pattern behaves as you see. Gun is shooting.

<a href="https://en.wikipedia.org/wiki/Gun_(cellular_automaton)"><img src="/images/blog/posts/distributed-game-of-life-in-elixir/gospers_glider_gun.gif" /></a>

Let's write this pattern down. Imagine you want to put the pattern in a rectangle. Left bottom corner of the rectangle is at `{0, 0}` position.

{% highlight elixir %}
# lib/game_of_life/patterns/guns.ex
defmodule GameOfLife.Patterns.Guns do
  @moduledoc """
  https://en.wikipedia.org/wiki/Gun_(cellular_automaton)
  """

  @doc """
  https://en.wikipedia.org/wiki/File:Game_of_life_glider_gun.svg
  """
  def gosper_glider do
    [
      {24, 8},
      {22, 7}, {24, 7},
      {12, 6}, {13, 6}, {20, 6}, {21, 6}, {34, 6}, {35, 6},
      {11, 5}, {15, 5}, {20, 5}, {21, 5}, {34, 5}, {35, 5},
      {0, 4}, {1, 4}, {10, 4}, {16, 4}, {20, 4}, {21, 4},
      {0, 3}, {1, 3}, {10, 3}, {14, 3}, {16, 3}, {17, 3}, {22, 3}, {24, 3},
      {10, 2}, {16, 2}, {24, 2},
      {11, 1}, {15, 1},
      {12, 0}, {13, 0},
    ]
  end
end
{% endhighlight %}

It would be also useful if we could place the pattern on the board in the position specified by us. Let's write pattern converter.

{% highlight elixir %}
# lib/game_of_life/pattern_converter.ex
defmodule GameOfLife.PatternConverter do
  @doc """
  ## Example
      iex> GameOfLife.PatternConverter.transit([{0, 0}, {1, 3}], -1, 2)
      [{-1, 2}, {0, 5}]
  """
  def transit([{x, y} | cells], x_padding, y_padding) do
    [{x + x_padding, y + y_padding} | transit(cells, x_padding, y_padding)]
  end

  def transit([], _x_padding, _y_padding), do: []
end
{% endhighlight %}

This is the way how you can add the gosper glider pattern to the board with specified position.

{% highlight elixir %}
GameOfLife.Patterns.Guns.gosper_glider
|> GameOfLife.PatternConverter.transit(-2, -3)
|> GameOfLife.BoardServer.add_cells
{% endhighlight %}

You can find [more patterns in modules here](https://github.com/BeyondScheme/elixir-game_of_life/tree/master/lib/game_of_life/patterns).

# Run game across multiple nodes

Now it is time to run our game. The full [source code can be found here](https://github.com/BeyondScheme/elixir-game_of_life).

Let's run first node where the `GameOfLife.BoardServer` will be running.

{% highlight plain %}
$ iex --sname node1 -S mix
Erlang/OTP 18 [erts-7.3] [source] [64-bit] [smp:4:4] [async-threads:10] [hipe] [kernel-poll:false] [dtrace]
Interactive Elixir (1.2.4) - press Ctrl+C to exit (type h() ENTER for help)

16:54:08.554 [info]  Started Elixir.GameOfLife.BoardServer master

iex(node1@Artur)1> GameOfLife.BoardServer.start_game
:game_started

iex(node1@Artur)2> GameOfLife.GamePrinter.start_printing_board
:printing_started
{% endhighlight %}

In another terminal window you can start second node. We will connect it with the first node.

{% highlight plain %}
$ iex --sname node2 -S mix
Erlang/OTP 18 [erts-7.3] [source] [64-bit] [smp:4:4] [async-threads:10] [hipe] [kernel-poll:false] [dtrace]
Interactive Elixir (1.2.4) - press Ctrl+C to exit (type h() ENTER for help)

16:55:17.395 [info]  Started Elixir.GameOfLife.BoardServer master

iex(node2@Artur)1> Node.connect :node1@Artur
true
16:55:17.691 [info]  Started Elixir.GameOfLife.BoardServer slave

iex(node2@Artur)2> Node.list
[:node1@Artur]

iex(node2@Artur)3> Node.self
:node2@Artur

iex(node2@Artur)4> GameOfLife.Patterns.Guns.gosper_glider |> GameOfLife.BoardServer.add_cells
[{24, 8}, {22, 7}, {24, 7}, {12, 6}, {13, 6}, {20, 6}, {21, 6}, {34, 6},
 {35, 6}, {11, 5}, {15, 5}, {20, 5}, {21, 5}, {34, 5}, {35, 5}, {0, 4}, {1, 4},
 {10, 4}, {16, 4}, {20, 4}, {21, 4}, {0, 3}, {1, 3}, {10, 3}, {14, 3}, {16, 3},
 {17, 3}, {22, 3}, {24, 3}, {10, 2}, {16, 2}, {24, 2}, {11, 1}, {15, 1},
 {12, 0}, {13, 0}]
{% endhighlight %}

Both nodes are executing calculation to determine a new state for living cells. You can run game also across diferrent servers in the network. You can do that like that:

{% highlight plain %}
# start node1
$ iex --name node1@192.168.0.101 --cookie "token_for_cluster" -S mix

# start node2 on another server
$ iex --name node2@192.168.0.102 --cookie "token_for_cluster" -S mix
iex> Node.connect :"node1@192.168.0.101"
true
{% endhighlight %}

You could already see how the game works in the demo at the beginning of the article. You can try it on your own machine, just clone the [repository](https://github.com/BeyondScheme/elixir-game_of_life).

# Summary

Finnally we managed to get to the end. It was a pretty long road but we have a working game, distributed across nodes. We learned how to write GenServer, use Agents, split processes across nodes with TaskSupervisor and connect nodes into the cluster. You also saw examples of tests in Elixir and how to use DocTest.

Hope you found something interesting in the article. Please share your thoughts in the comments.
