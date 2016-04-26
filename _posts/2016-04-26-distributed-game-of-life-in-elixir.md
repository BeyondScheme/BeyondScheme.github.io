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
* How to use TaskSupervisor, Tasks and Agents in Elixir

> This is a very simple project and if you find yourself more experience please share your comments how to improve the code described here. Thanks!

# Just intro to Game of Life rules

If you haven't heard about [game of life problem](https://en.wikipedia.org/wiki/Conway%27s_Game_of_Life) then here is basic concept. If you already know it, just jump to next header.

The universe of the Game of Life is an infinite two-dimensional orthogonal grid of square cells, each of which is in one of two possible states, alive or dead. Every cell interacts with its eight neighbours, which are the cells that are horizontally, vertically, or diagonally adjacent. At each step in time, the following transitions occur:

* Any live cell with fewer than two live neighbours dies, as if caused by under-population.
* Any live cell with two or three live neighbours lives on to the next generation.
* Any live cell with more than three live neighbours dies, as if by over-population.
* Any dead cell with exactly three live neighbours becomes a live cell, as if by reproduction.

The initial pattern constitutes the seed of the system. The first generation is created by applying the above rules simultaneously to every cell in the seed—births and deaths occur simultaneously, and the discrete moment at which this happens is sometimes called a tick (in other words, each generation is a pure function of the preceding one). The rules continue to be applied repeatedly to create further generations.
