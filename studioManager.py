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

    os.environ['LIGHTNING_API_KEY'] = credentials["apiKey"]
    os.environ['LIGHTNING_USER_ID'] = credentials["userID"]
    
    _studio = Studio(
        credentials["studioName"],
        credentials["teamspaceName"],
        user = credentials["user"],
        create_ok = False
    )

    if action == "stop_single":
        stopStudio(_studio, credentials)
    elif action == "start_single":
        startStudio(_studio, credentials)
    elif action == "train_single":
        startTraining(_studio, credentials, forceNewRun, forceConfig, config)
    elif action == "status_single":
        getStatus(_studio, credentials)
    elif action == "training_stat":
        uploadTrainingImages(_studio, credentials, params["botToken"], params["chatId"])
    elif action == "upload_results":
        uploadAllResults(_studio, credentials, params["botToken"], params["chatId"])    
    elif action == "check_duplicate_config":
        checkForDuplicateConfig(_studio, credentials, config)  
    else:
        print(f"No valid action provided. Provided action {action}")
except Exception as e:
    print("Faced an exception at studioManager: ", str(e))