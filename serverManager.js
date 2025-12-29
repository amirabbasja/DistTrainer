import TelegramBot from "node-telegram-bot-api"
import {config} from 'dotenv'
import fs from 'fs/promises'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { writeFile } from 'fs/promises'

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj))
}

function flattenTuningOptionsToSpec(tuningOptions) {
    const paths = []
    const values = []

    const walk = (prefix, node) => {
        if (node && typeof node === "object" && !Array.isArray(node)) {
            for (const [k, v] of Object.entries(node)) {
                walk(prefix.concat(k), v)
            }
        } else if (Array.isArray(node)) {
            paths.push(prefix.join("."))
            values.push(node)
        } else {
            throw new TypeError("tuning_options leaf values must be arrays.")
        }
    }

    walk([], tuningOptions || {})
    return { paths, values }
}

function generateIndexCombos(spec) {
    const lengths = spec.values.map((arr) => arr.length)
    if (lengths.length === 0) return [[]]

    const combos = []
    const cur = new Array(lengths.length).fill(0)

    const rec = (i) => {
        if (i === lengths.length) {
            combos.push(cur.slice())
            return
        }
        for (let idx = 0; idx < lengths[i]; idx++) {
            cur[i] = idx
            rec(i + 1)
        }
    }

    rec(0)
    return combos
}

function combosToOverrides(spec, indexCombo) {
    const overrides = {}
    for (let i = 0; i < spec.paths.length; i++) {
        const path = spec.paths[i]
        const valIdx = indexCombo[i]
        overrides[path] = spec.values[i][valIdx]
    }
    return overrides
}

function setByDotPath(obj, dotPath, value) {
    const keys = dotPath.split(".")
    let cur = obj
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]
        if (cur[k] == null || typeof cur[k] !== "object") {
            cur[k] = {}
        }
        cur = cur[k]
    }
    cur[keys[keys.length - 1]] = value
}

function applyOverrides(baseConfig, overrides) {
    const cfg = deepClone(baseConfig)
    for (const [dotPath, value] of Object.entries(overrides)) {
        setByDotPath(cfg, dotPath, value)
    }
    return cfg
}


async function readJsonFile(path) {
    try {
        const data = await fs.readFile(path, 'utf8')
        const jsonData = JSON.parse(data) // Parse JSON string to object
        return jsonData
    } catch (err) {
        throw new Error('Error:' + err)
    }
}

async function saveJSONFile(filePath, obj) {
    try {
      const jsonString = JSON.stringify(obj, null, 4) // Pretty-print with 2 spaces
        await writeFile(filePath, jsonString, 'utf8')
    } catch (error) {
        console.error('Error saving JSON:', error.message)
    }
}

// Function to run a Python script with a given parameter and 10-minute timeout
function runPythonScript(loc, param, timedKill = false) {
    return new Promise((resolve, reject) => {
        // Spawn a child process to run the Python script
        let args = []
        args = [loc, JSON.stringify(param)]

        const pythonProcess = spawn('python', args)

        let studioName = JSON.parse(param.credentials).user
        let output = ''
        let errorOutput = ''
        let isResolved = false

        let timeout
        if (timedKill) {
            timeout = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true
                    
                    // Kill the process and all its children
                    pythonProcess.kill('SIGKILL')
                    
                    resolve(`Parameter ${param}: Process timed out after 10 minutes`)
                }
            }, 10 * 60 * 1000) // 10 minutes
        }

        // Capture standard output
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString()
            // console.log(data.toString())
        })

        // Capture standard error
        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString()
        })

        // Handle process exit
        pythonProcess.on('close', (code) => {
            if (!isResolved) {
                if(timedKill){
                    clearTimeout(timeout)
                }
                isResolved = true
                
                if (code === 0) {
                    resolve(`${studioName}: ${output}`)
                } else {
                    reject(`${studioName} failed with code ${code}: ${errorOutput}`)
                }
            }
        })

        // Handle errors when starting the process
        pythonProcess.on('error', (err) => {
            if (!isResolved) {
                if(timedKill){
                    clearTimeout(timeout)
                }
                isResolved = true
                reject(`Failed to start process for ${studioName}: ${err.message}`)
            }
        })
    })
}

config({path: './.env'})
const token = process.env.BOT_TOKEN
const trgetChatId = process.env.CHAT_ID
let isHyperparameterTuning = false
let infiniteTraining = false
if (!token) {
    throw new Error("No BOT_TOKEN env variable set")
}
if (!trgetChatId) {
    throw new Error("No CHAT_ID env variable set")
}

const bot = new TelegramBot(token, {polling: true})
const studios = await readJsonFile("./studios.json")

console.log("Bot started")
bot.on('message', async (msg) => {
    const chatId = msg.chat.id
    const text = msg.text
    let textToSend = ""
    let lastMessageId = null

    if(text === "list"){
        // Lists all availible studios
        const studios = await readJsonFile("./studios.json")
        textToSend = "Available Studios:\n" + Object.keys(studios).map(s => `- ${s} (${studios[s].user})`).join("\n")
        bot.sendMessage(chatId, textToSend)
    } else if(text.toLowerCase()?.startsWith("stop single")){
        // Stopps a studio
        const parts = text.split(" ")
        let studioName = parts[2]
        if(!studioName || Object.keys(studios).indexOf(studioName) === -1){
            bot.sendMessage(chatId, "Please provide a correct studio name. Usage: stop single <studio_name>")
            return
        }
        
        bot.sendMessage(chatId, `Stopping studio: ${studios[studioName].user}`).then(sentMsg => {lastMessageId = sentMsg.message_id})
        const params = { action: "stop_single", credentials: JSON.stringify(studios[studioName])}
        const result = await runPythonScript("./studioManager.py", params)
        if(result.includes("not running")){
            bot.editMessageText(`Studio ${studios[studioName].user} is already stopped`, {chat_id: chatId, message_id: lastMessageId})
        } else if (!result.includes("Error") &&  result.includes("Success")){
            bot.editMessageText(`Studio ${studios[studioName].user} stopped`, {chat_id: chatId, message_id: lastMessageId})
        } else {
            bot.editMessageText(`Unknown error for stopping studio ${studios[studioName].user}: ${result}`, {chat_id: chatId, message_id: lastMessageId})
        }
    } else if(text.toLowerCase()?.startsWith("stop_all")){
        // Stops all studios
        bot.sendMessage(chatId, `Stopping all studios (0/${Object.keys(studios).length}) ...`).then(sentMsg => {lastMessageId = sentMsg.message_id})
        let i = 1
        for(let name of Object.keys(studios)){
            const params = { action: "stop_single", credentials: JSON.stringify(studios[name])}
            const result = await runPythonScript("./studioManager.py", params)
            bot.editMessageText(`Studio ${studios[name].user} stopped`, {chat_id: chatId, message_id: lastMessageId})
        }
        bot.sendMessage(chatId, `All studios stopped.`)
        infiniteTraining = false
    } else if(text.toLowerCase()?.startsWith("status") && !text.toLowerCase()?.startsWith("status_all")){
        // gets status for a single studop
        const parts = text.split(" ")
        let studioName = parts[1]
        if(!studioName || Object.keys(studios).indexOf(studioName) === -1){
            bot.sendMessage(chatId, "Please provide a correct studio name. Usage: status <studio_name>")
            return
        }
        const params = { action: "status_single", credentials: JSON.stringify(studios[studioName])}
        const result = await runPythonScript("./studioManager.py", params)
        if(result.includes("Error")){
            bot.sendMessage(chatId, `Error getting status for ${studios[studioName].user}: ${result}`)
        } else {
            bot.sendMessage(chatId, `Status for ${studios[studioName].user}: ${result}`)
        }
    } else if(text.toLowerCase()?.startsWith("status_all")){
        // Gets status for all studios
        const parts = text.split(" ")
        let noRunning = []
        let running = []
        let error = []
        bot.sendMessage(chatId, `Getting status for all studios (0/${Object.keys(studios).length}) ...`).then(sentMsg => {lastMessageId = sentMsg.message_id})

        let i = 1
        for(let name of Object.keys(studios)){
            const params = { action: "status_single", credentials: JSON.stringify(studios[name])}
            const result = await runPythonScript("./studioManager.py", params)
            if(result.includes("Error")){ error.push(name) }
            else if(result.includes("Running")){ running.push(name) }
            else { noRunning.push(`${name} (${studios[name].user})`) }
            bot.editMessageText(`Getting status for all studios (${i}/${Object.keys(studios).length}) ...`, {chat_id: chatId, message_id: lastMessageId})
            i++
        }

        bot.editMessageText(`All studios status:\nNot running:\n   ${noRunning.join("\n   ")}\nRunning:\n   ${running.join("\n   ")}\nError:\n   ${error.join("\n   ")}`, {chat_id: chatId, message_id: lastMessageId})
    } else if (text.toLowerCase()?.startsWith("train_single")){
        let forceNewRun = false
        let forcedConf = undefined
        if(text.toLowerCase().includes("force_new_run")){ forceNewRun = true }
        if(text.toLowerCase().includes("force_config")){ forcedConf = JSON.parse( text.split("force_config", 2)[1]?.trim() ?? "") }

        // gets status for a single studio
        const parts = text.split(" ")
        let studioName = parts[1]
        if(!studioName || Object.keys(studios).indexOf(studioName) === -1){
            bot.sendMessage(chatId, "Please provide a correct studio name. Usage: status <studio_name>")
            return
        }
        const params = { action: "status_single", credentials: JSON.stringify(studios[studioName]) }
        const result = await runPythonScript("./studioManager.py", params)

        if(result.includes("Stopped")){
            const _params = { action: "train_single", credentials: JSON.stringify(studios[studioName]), forceNewRun: forceNewRun}
            if(forcedConf) {
                _params.forceConfig = true
                _params.config = JSON.stringify(forcedConf)
            }
            runPythonScript("./studioManager.py", _params, true) // Not awaiting it, with timed kill
            await new Promise(resolve => setTimeout(resolve, 1000))
            bot.sendMessage(chatId, `Starting studio ${studios[studioName].user} for training `).then(sentMsg => {lastMessageId = sentMsg.message_id})
        } else {
            console.log(result)
            bot.sendMessage(chatId, `Studio ${studios[studioName].user} is not Stopped. Needs to be stopped to start training `)
        }
    } else if (text.toLowerCase()?.startsWith("train_all")){
        let forceNewRun = false
        if(text.toLowerCase().includes("force_new_run")){ forceNewRun = true }

        infiniteTraining = true
        while(infiniteTraining){
            bot.sendMessage(chatId, `Starting training for all studios (0/${Object.keys(studios).length}) ...`).then(sentMsg => {lastMessageId = sentMsg.message_id})
            let i = 1
            for(let name of Object.keys(studios)){
                const params = { action: "train_single", credentials: JSON.stringify(studios[name]), forceNewRun: forceNewRun}
                runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
                await new Promise(resolve => setTimeout(resolve, 1000))
                bot.sendMessage(chatId, `Starting studio ${studios[name].user} for training `).then(sentMsg => {lastMessageId = sentMsg.message_id})
                i++
                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
            }

            forceNewRun = false // Only for the first run
            bot.sendMessage(chatId, `All studios started for training. Waiting 4 hours before next training round...`)

            await new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000)) // A 4 hour delay
        }
    } else if(text.toLowerCase() === "stop_training"){
        infiniteTraining = false
        bot.sendMessage(chatId, "Infinite training loop stopped. Training will not continue after active sessions are done.")
    } else if(text.toLowerCase().startsWith("training_stat")){
        const parts = text.split(" ")
        let studioName = parts[1]
        if(!studioName || Object.keys(studios).indexOf(studioName) === -1){
            bot.sendMessage(chatId, "Please provide a correct studio name. Usage: training_stat <studio_name>")
            return
        }
        const params = { action: "training_stat", credentials: JSON.stringify(studios[studioName]), botToken: token, chatId: chatId }
        await runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
    } else if(text.toLowerCase().startsWith("upload_all_results")){
        const parts = text.split(" ")
        let studioName = parts[1]
        if(!studioName || Object.keys(studios).indexOf(studioName) === -1){
            bot.sendMessage(chatId, "Please provide a correct studio name. Usage: training_stat <studio_name>")
            return
        }
        const params = { action: "upload_results", credentials: JSON.stringify(studios[studioName]), botToken: token, chatId: chatId }
        await runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
    } else if(text.toLowerCase().startsWith("tune_grid_search")){
        if(isHyperparameterTuning){
            bot.sendMessage(chatId, "Already tuning parameters. Can not tun multiple grid search instances for now.")
        } else {
            isHyperparameterTuning = true
        }

        bot.sendMessage(chatId, "Starting to tune parameters")

        if(!await existsSync("./tune_params.json")){
            bot.sendMessage(chatId, "tune_params.json file not found")
        }

        let tuningParams = await readJsonFile("./tune_params.json")

        // When using this approach for tuning, continue_run has to be always true
        if (!tuningParams.continue_run) {
            tuningParams.continue_run = true
        }
        
        if(!tuningParams.tune){
            bot.sendMessage(chatId, "tuning not true")
            return
        }
        
        if(!tuningParams.tuning){
            bot.sendMessage(chatId, "no information for tuning is provided")
            return
        }

        // Make necessary parameters and alculate combinations to be assigned to servers (if doesnt exist)
        if(
            !tuningParams.tuning.availibleStudios ||
            !tuningParams.tuning.spec ||
            !tuningParams.tuning.unassigned ||
            !tuningParams.tuning.assigned ||
            !tuningParams.tuning.finished
        ){
            const availibleStudios = Object.keys(await readJsonFile("./studios.json"))
            tuningParams.tuning.availibleStudios = availibleStudios

            // Get an array of key paths that will be overriden with tuing parameters (in "paths" key) 
            // and an array of aaceptable values for each path (in "values" key)
            const spec = flattenTuningOptionsToSpec(tuningParams.tuning.tuning_options)
            tuningParams.tuning.spec = spec

            // An array of all possible combinations
            const combos = generateIndexCombos(spec)
            tuningParams.tuning.unassigned = combos

            // Aggregate all info to one key
            tuningParams.tuning.compact = { paths: spec.paths, values: spec.values, combos }

            // Assigned to every studio
            tuningParams.tuning.assigned = Object.fromEntries(availibleStudios.map(key => [key, []]))

            // Assigned to every studio
            tuningParams.tuning.finished = []
            
            await saveJSONFile("./tune_params.json", tuningParams)
        }


        let forceNewRun = false
        if(text.toLowerCase().includes("force_new_run")){ forceNewRun = true }

        infiniteTraining = true
        while(infiniteTraining) {
            bot.sendMessage(chatId, `Starting training for all studios (0/${Object.keys(studios).length}) ...`).then(sentMsg => {lastMessageId = sentMsg.message_id})
            let i = 1
            for(let i = 0; i < Object.keys(studios).length; i++){
                try{

                    let name = Object.keys(studios)[i]
                    console.log("===== new studio =====\nName:", name)
                    // Update the tuning parameters
                    tuningParams =  await readJsonFile("./tune_params.json")
    
                    // Check to see if this studio has an assigned combination. If already assigned, run it.
                    if(tuningParams.tuning.assigned[name].length != 0) {
                        const _combination = tuningParams.tuning.assigned[name][0]
                        const keysToOverride = combosToOverrides(tuningParams.tuning.compact, _combination)
                        const config = applyOverrides(tuningParams, keysToOverride)
                        
                        delete config.tune
                        delete config.tuning
    
                        const params = { 
                            action: "check_duplicate_config", 
                            credentials: JSON.stringify(studios[name]), 
                            config: JSON.stringify(config)
                        }
                        
                        const result = await runPythonScript("./studioManager.py", params, true) 
    
                        if(result.includes("false: unfinished duplicate found")){
                            console.log(name, "continuing prev run")
                            // Training hasn't finished
                            const params = { 
                                action: "train_single", 
                                credentials: JSON.stringify(studios[name]), 
                            }
                            runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
                            await new Promise(resolve => setTimeout(resolve, 1000))
                            bot.sendMessage(chatId, `Starting studio ${studios[name].user} for training `).then(sentMsg => {lastMessageId = sentMsg.message_id})
                        } else if(result.includes("true: finished duplicate found")) {
                            console.log(name, "finished run found")
                            // Training has finished, remove this combo from assigned and move it to finished
                            tuningParams.tuning.finished.push(tuningParams.tuning.assigned[name][0])
                            tuningParams.tuning.assigned[name] = []
                            await saveJSONFile("./tune_params.json", tuningParams)
    
                            // Assign a new combo
                            i = i -1
                        } else if(result.includes("false: no duplicates found")) {
                            // Impossible to reach here
                            bot.sendMessage(chatId, `Eraaror 1 when running config for ${name}: ${result}`).then(sentMsg => {lastMessageId = sentMsg.message_id})
                        } else {
                            bot.sendMessage(chatId, `Error 2 when running config for ${name}: ${result}`).then(sentMsg => {lastMessageId = sentMsg.message_id})
                        }
                    } else {
                        // If no combos are assigned to the server, assign a new one
                        while(true){
                            // Choose a random unassigned combination
                            let _idxMain = getRandomInt(0, tuningParams.tuning.unassigned.length)
                            const _combination = tuningParams.tuning.unassigned[_idxMain]
                            
                            const keysToOverride = combosToOverrides(tuningParams.tuning.compact, _combination)
                            const config = applyOverrides(tuningParams, keysToOverride)
                            delete config.tune
                            delete config.tuning
        
                            const params = { 
                                action: "check_duplicate_config", 
                                credentials: JSON.stringify(studios[name]), 
                                keysToOverride: keysToOverride,
                                config: JSON.stringify(config)
                            }
                            
                            const result = await runPythonScript("./studioManager.py", params, true) 
                            
                            if(result.includes("true: finished duplicate found")){
                                // Won't reach here. Added here as a failsafe
                                // Training has finished. Assign a new combination to this and move the current combination to the finished key
                                const _idx = getRandomInt(0, tuningParams.tuning.unassigned.length)
                                const _combination = tuningParams.tuning.unassigned[_idx]
                                if (_idx != -1) {tuningParams.tuning.unassigned.splice(_idx, 1)}
                                tuningParams.tuning.finished.push(_combination)
                                await saveJSONFile("./tune_params.json", tuningParams)
                                
                                // Assign a new combo
                                i = i -1
                                break
                            } else if (result.includes("false: unfinished duplicate found")){
                                // Won't reach here. Added here as a failsafe
                                // Training hasn't finished. Run the combo until finished
                                const params = { 
                                    action: "train_single", 
                                    credentials: JSON.stringify(studios[name]), 
                                    forceNewRun: forceNewRun
                                }
                                runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
                                await new Promise(resolve => setTimeout(resolve, 1000))
                                bot.sendMessage(chatId, `Starting studio ${studios[name].user} for training `).then(sentMsg => {lastMessageId = sentMsg.message_id})
                                break
                            } else if ("false: no duplicates found") {
                                console.log(name, "starting a new run")
                                // Start a fresh run
                                tuningParams.tuning.unassigned.splice(_idxMain, 1)
                                tuningParams.tuning.assigned[name] = [_combination]
                                await saveJSONFile("./tune_params.json", tuningParams)
    
                                // Run with --forceconfig flag
                                const params = { 
                                    action: "train_single", 
                                    credentials: JSON.stringify(studios[name]), 
                                    forceConfig: true,
                                    config: JSON.stringify(config)
                                }
                                
                                runPythonScript("./studioManager.py", params, true) // Not awaiting it, with timed kill
                                await new Promise(resolve => setTimeout(resolve, 1000))
                                bot.sendMessage(chatId, `Starting studio ${studios[name].user} for training `).then(sentMsg => {lastMessageId = sentMsg.message_id})
                                break
                            }
    
                        }
                    }
    
                    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
                    console.log("finished one run")
                } catch (err) {
                    bot.sendMessage("******** ERROR ********")
                    bot.sendMessage(studios[Object.keys(studios)[i]])
                    
                    console.log("******** ERROR ********")
                    console.log(studios[Object.keys(studios)[i]])
                    console.log(err)
                    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
                }
            }

            forceNewRun = false // Only for the first run
            bot.sendMessage(chatId, `All studios started for training. Waiting 4 hours before next training round...`)

            await new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000)) // A 4 hour delay
        }
    } else {
        // If the command is not recognized, send a help message
        textToSend = "<b>Help: </b>\n\n" +
        "- <code>list</code>: <i>Lists all available studios </i>\n" +
        "- <code>stop single studio_name</code>: <i>Stops the specified studio </i>\n" +
        "- <code>stop_all</code>: <i>Stops all running studios </i>\n" +
        "- <code>status studio_name</code>: <i>Gets the status of the specified studio </i>\n" +
        "- <code>status_all</code>: <i>Gets the status of all studios </i>\n" +
        "- <code>train_all</code>: <i>Starts training for all studios (with 5 minutes delay between each start)  </i> \n" +
        "- <code>train_all force_new_run</code>: <i>Starts training for all studios with a forced new run in each server </i> \n" +
        "- <code>train_single studio_name optional:force_new_run</code>: <i>Starts training a specific studio </i> \n" +
        "- <code>stop_training</code>: <i>Stops further initiations of training </i> \n" +
        "- <code>training_stat studio_name</code> : <i>Gets the training status of the specified studio </i>\n" +
        "- <code>upload_all_results studio_name</code> : <i>Uploads all results from a specific studio in separate zip files </i>\n" +
        "- <code>tune_grid_search</code> : <i>Tunes algorithm parameters using grid search</i>\n"

        bot.sendMessage(chatId, textToSend, { parse_mode: 'HTML' })
    }
})