# DistTrainer

*A simple repository for distributed training of machine learning models accross mutiple HPCs.*


## Overview

Dist trainer is a repository written in javascript (Empowered by Node.js) and Python for running multiple scripts in multiple HPCs (High performance computers) derived them a single machine. It is simple, and easy to use. In the latest version of this project, **gride search** for hyperparameter tuning of a machine learning model is added. For now, we have adapted this project for using lightning studios. other than CLI, this code can also be controlled from a telegram bot. 

## How to install

1. Have a (or multiple) HPCs to train on.

2. Install Python and Node.js on the machine that is for driving the training process on other servers.

3. install necessary python dependencies with following command:

    ```
        pip install lightning-sdk
    ```

4. Make a telegram bot and pass its token, and your chatID in the .env file. **(optional)**

## How to use

The code can be used in two ways, 1. To run multiple scripts on multiple servers, 2. To tune hyperParameters of a machine learning model with random grid search.

* Running using telegram:

    ```
        node serverManager.js
    ```

* Running using CLI:

    Some examples:

    ```
        node serverManager.js list
        node serverManager.js status studio_name
        node serverManager.js train_single my_studio
        node serverManager.js train_all force_new_run
        node serverManager.js stop_all
    ```

### Running multiple scripts on multiple servers

Send the following commands to the bot (either via CLI or the telegram bot):

1. `list` : *Lists all available studios*
2. `stop single studio_name`: *Stops the specified studio*
3. `start single studio_name`: *Starts the specified studio*
4. `stop_all`: *Stops all running studios*
5. `start_all`: *Starts all studios*
6. `status studio_name`: *Gets the status of the specified studio*
7. `status_all`: *Gets the status of all studios*
8. `train_all`: *Starts training for all studios (with 5 minutes delay between each start)*
9. `train_single studio_name`: *Starts training for the specified studio (with 5 minutes delay between each start)*
10. `train_all force_new_run`: *Starts training for all studios with a forced new run in each server*
11. `train_single studio_name force_new_run`: *Starts training for the specified studio with a forced new run in each server*
12. `stop_training`: *Stops further initiations of training*

### Hyperparameter tuning with grid search

Pass following commands to the bot (either via CLI or the telegram bot) `tune_grid_search`