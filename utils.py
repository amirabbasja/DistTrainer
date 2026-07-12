import json, os, time, threading, asyncio, sys, json, time
from lightning_sdk import Machine, Studio
from functools import wraps

def _setCredentials(credentials):
    os.environ['LIGHTNING_API_KEY'] = credentials["apiKey"]
    os.environ['LIGHTNING_USER_ID'] = credentials["userID"]

def withCredentials(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        credentials = args[0] if args else kwargs.get("credentials")
        if not credentials:
            raise ValueError(f"Missing credentials for {func.__name__}")
        _setCredentials(credentials)
        return func(*args, **kwargs)
    return wrapper

@withCredentials
def stopStudio(studio, credentials):
    try:
        studio.stop()
        print(f"Success on stopping studio {credentials['user']}")
    except Exception as e:
        print(f"Error stopping studio. Error: {e}")

@withCredentials
def startStudio(studio, credentials):
    try:
        studio.start()
        print(f"Success on starting studio {credentials['user']}")
    except Exception as e:
        print(f"Error starting studio. Error: {e}")

@withCredentials
def getStatus(studio, credentials):
    try:
        status = str(studio.status)
        print("STUDIO STATUS:", status)
        return status
    except Exception as e:
        return f"Error fetching status for {credentials['user']}: {e}"

@withCredentials
def uploadTrainingImages(studio, credentials, botToken, chatId):
    try:
        runCommand(studio, credentials, f"python '/teamspace/studios/this_studio/serverRunner/uploadLatestTrainingData.py' --bot-token '{botToken}' --chat-id '{chatId}'")
    except Exception as e:
        print(f"Error uploading training images. Error: {e}")

@withCredentials
def checkForDuplicateConfig(studio, credentials, config):

    try:
        # Start the studio
        startStudio(studio, credentials)
    except:
        pass
    time.sleep(10)
        
    try:
        result = runCommand(studio, credentials, f"python '/teamspace/studios/this_studio/resultAggregator.py' --check_duplicate_config '{config}'")
        # print(f"python '/teamspace/studios/this_studio/resultAggregator.py' --check_duplicate_config '{config}'")
        print(result)
        return result
    except Exception as e:
        print(f"Error finding duplicates. Error: {e}")
        return None

@withCredentials
def uploadAllResults(studio, credentials, botToken, chatId):
    _status = getStatus(studio, credentials)
    if(_status == "Stopping"):
        while True:
            print("Studio is stopping. Waiting for it to stop...")
            _status = getStatus(studio, credentials)
            if(_status != "Stopping"):
                break
            time.sleep(30)
    
    if(_status == "Stopped"):
        startStudio(studio, credentials)
        time.sleep(10)
    
    try:
        runCommand(studio, credentials, f"python '/teamspace/studios/this_studio/resultAggregator.py' --upload_to_telegram")
    except Exception as e:
        print(f"Error uploading results. Error: {e}")

@withCredentials
def runCommand(studio, credentials, command):
    """
    Runs a designated studio with a specific command
    """
    try:
        res = studio.run(command)
        return res
    except Exception as e:
        print("Error running command: "+ str(e))
        return None

@withCredentials
def startTraining(studio, credentials, forceNewRun = False, forceConfig = False, customConfig = ""):
    """
    Starts a training bout by checking the status of the studio and running the command

    Args:
        studio (Studio): The studio instance
        credentials (dict): Dictionary containing the studio credentials
        forceNewRun (bool, optional): If True, forces a new run by adding the --forcenewrun 
            flag to the command. Defaults to False.
        forceConfig (bool, optional): If true, conf.json file will be disregarded and a 
            config has to be passed as the next arg
        customConfig (str, optional): The custom configuration, as a string (has to be 
            decodable by json.loads())
    """
    
    _status = getStatus(studio, credentials)
    print("DELETE: status:", _status)
    if(_status == "Stopping"):
        while True:
            print("Studio is stopping. Waiting for it to stop...")
            _status = getStatus(studio, credentials)
            if(_status != "Stopping"):
                break
            time.sleep(30)
    
    if(_status != "Stopped"):
        try:
            stopStudio(studio, credentials)
            time.sleep(10)
        except:
            pass
    
    try:
        # Start the studio
        startStudio(studio, credentials)
    except:
        pass
    time.sleep(10)

    # If instructed to force a new run, modify the command and add a flag
    if(forceNewRun):
        credentials["commandToRun"] = credentials["commandToRun"] + " --forcenewrun"

    # Run custom configuration
    if(forceConfig):
        if(customConfig != "" and json.loads(customConfig)):
            credentials["commandToRun"] = credentials["commandToRun"] + " --forceconfig" + " --config " + f"\'{customConfig}\'"
    print("command: ", credentials["commandToRun"])
    
    # Run the command
    runCommand(studio, credentials, credentials["commandToRun"])

