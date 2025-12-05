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

The code can be used in two ways, 1. To run multiple scripts on multiple servers, 2. To tune hyperparameters of a machine learning model with random grid search.

### Running multiple scripts on multiple servers

### Hyperparameter tuning with grid search