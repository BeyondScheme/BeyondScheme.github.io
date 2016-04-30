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
* How to use GenServer, TaskSupervisor and Agents in Elixir

This is a very simple project and if you find yourself more experience please share your comments how to improve the code described here. The full [source code can be found here](https://github.com/BeyondScheme/elixir-game_of_life). Thanks!

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

# Architecture of distributed Game of Life

<img src="/images/blog/posts/distributed-game-of-life-in-elixir/supervisor.jpg" />

Our main supervisor is `GameOfLife.Supervisor` which I mentioend at the begining of the article. Here you can see how we defined its childrens like `Task.Supervisor` or workers for `BoardServer` and `GamePrinter`.

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

Let me describe you what each component on the image is responsible for.

* `Task.Supervisor` is Elixir module which defines a new supervisor which can be used to dynamically supervise tasks. We are going to use it to spin off tasks like determining if the particular cell should live or die etc. Those tasks can be run across nodes connected into the cluster. In above code, we gave name `GameOfLife.TaskSupervisor` for our supervisor. We will use this name to tell `Task.Supervisor.async` function which Task Supervisor should handle our task. You can read more about [Task.Supervisor here](http://elixir-lang.org/docs/stable/elixir/Task.Supervisor.html).

* `GameOfLife.BoardServer` is our module implemented as [GenServer behaviour](http://elixir-lang.org/docs/stable/elixir/GenServer.html). It's responsible for holding the state of the game. By that I mean it keeps the list of alive cells on the board along with generation counter and TRef. TRef is a timer reference as we want to be able to start the game and generate a new list of alive cells for next generation of the game. With each new generation, we will update generation counter. The other interesting thing is that `GameOfLife.BoardServer` is running only on single node. Once another node is connected to cluster where is already running `GameOfLife.BoardServer` then the second `GameOfLife.BoardServer` won't be started as we want to have the single source of truth about the state of our game.

* `GameOfLife.GamePrinter` is a simple module using [Agent](http://elixir-lang.org/docs/stable/elixir/Agent.html) in order to keep TRef (time reference) so we can print board to STDOUT with specified interval. We will use [Erlang timer module](http://erlang.org/doc/man/timer.html#apply_interval-4) to print board on the screen every second.

You may wonder what's the difference between GenServer and Agent.

A GenServer is a process like any other Elixir process and it can be used to keep state, execute code asynchronously and so on. The advantage of using a generic server process (GenServer) is that it will have a standard set of interface functions and include functionality for tracing and error reporting. It also fits into a supervision tree as this is what we did in `GameOfLife` module.

Agent, on the other hand, is much simpler solution than GenServer. Agents are a simple abstraction around state.
Often in Elixir there is a need to share or store state that must be accessed from different processes or by the same process at different points in time. The Agent module provides a basic server implementation that allows state to be retrieved and updated via a simple API.
This is what we are going to do in `GameOfLife.GamePrinter` as we need only keep time reference to our timer interval.

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

As you can see we use `GenServer` behaviour in our module. I require also Logger as we would like to print some info to the STDOUT.

In `start_link/1` function we start new `GenServer`. When our generic server was started as a first process in the cluster then it becomes master process. In the case when there is already running process with globally registered name `{:global, __MODULE__}` we log info that our process will be a slave process with a reference to existing PID on another node in the cluster.

As you see we store global name for our server in attribute `@name`. We use another attribute `@game_speed` for default game speed which is 1000 miliseconds.

In our public interface, we have `alive_cells/1` function which returns the list of alive cells. Basically, it's the current state of the game (alive cells on the board). This function calls `GenServer` with registered `@name` and request `:alive_cells`. We need to implement `handle_call/3` function for this type of request (`:alive_cells`).

There is another public function `generation_counter/1` which returns how many generations was already processed by board server.

The `state/1` function returns state that is held by our generic server. The state is represented as the tuple with 3 values like alive cells, TRef (time reference - we want to regenerate board every second) and generation counter. TRef is very internal thing for board server so we won't return this to outside world. That's why we will return just alive cells and generation counter. You will see it later in implementation for `handle_call(:state, _from, state)`.

You can use `set_alive_cells/1` function in the case when you want to override current list of alive cells with a new list.

The `add_cells/1` function will be very usefull as we want to be able to add new cells or figures to the board. For instance we may want to add a blinker pattern to existing game. You will learn more about patterns later.

<a href="https://en.wikipedia.org/wiki/File:Game_of_life_blinker.gif"><img src="/images/blog/posts/distributed-game-of-life-in-elixir/blinker.gif" /></a>

We can manually force game to calculate next generation of cells with `tick/1` function.

The `start_game/1` function is responsible for starting a new timer which calls every second a `tick/1` function. Thanks to that our game will update list of alive cells with specified interval which is `@game_speed`.

The last 2 functions are `stop_game/1` and `change_speed/1` which just restart the game and starts a new one with provided speed.

Now you can take a look how above functions are working exactly because they are calling server callbacks.

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

Our test file is super short.

{% highlight elixir %}
# test/game_of_life/board_server_test.exs
defmodule GameOfLife.BoardServerTest do
  use ExUnit.Case
  doctest GameOfLife.BoardServer
end
{% endhighlight %}

Let's add `@moduledoc` do `GameOfLife.BoardServer`.

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

We will add some useful function `GameOfLife.Board` module which helps us do operations on the list of alive cells.

Another thing you noticed is how we use `Task.Supervisor` in:

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

We need some helper functions for operations we can do on board like adding, removing cells. Let's start with tests for module `GameOfLife.Board` and function `add_cells/2`.

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

We need to ensure we won't allow to add the same cell twice to the board hence the above test. Here is implementation for `add_cells/2` function:

{% highlight elixir %}
# lib/game_of_life/board.ex
defmodule GameOfLife.Board do
  def add_cells(alive_cells, new_cells) do
    alive_cells ++ new_cells
    |> Enum.uniq
  end
end
{% endhighlight %}

Another thing is removing cells from the list of alive cells.

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

TODO

# Add figure patterns and place them on the board

TODO

# Run game across multiple nodes

TODO

# Summary