import sys, os, json
from utils import *

try:
    params = json.loads(sys.argv[1])
    action = params.get("action", "")
    credentials = json.loads(params.get("credentials", {}))

    # For running commands
    forceNewRun = params.get("forceNewRun", False)
    forceConfig = params.get("forceConfig", False)
    config = params.get("config", "")
    keysToOverride = params.get("keysToOverride", "")

    if action == "stop_single":
        stopStudio(credentials)
    elif action == "start_single":
        startStudio(credentials)
    elif action == "train_single":
        startTraining(credentials, forceNewRun, forceConfig, config)
    elif action == "status_single":
        getStatus(credentials)
    elif action == "training_stat":
        uploadTrainingImages(credentials, params["botToken"], params["chatId"])
    elif action == "upload_results":
        uploadAllResults(credentials, params["botToken"], params["chatId"])    
    elif action == "check_duplicate_config":
        checkForDuplicateConfig(credentials, config)  
    else:
        print("No valid action provided")
except Exception as e:
    print("Faced an exception at studioManager: ", str(e))