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
            console.log("OUTPUT:", data.toString())
        })

        // Capture standard error
        pythonProcess.stderr.on('data', (data) => {
            errorOutput += data.toString()
            console.log("ERROR:", data.toString())
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
            console.log("ERROR:", err.toString())
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

// Message sender interface that works for both Telegram and CLI
class MessageSender {
    constructor(type, chatId = null, bot = null) {
        this.type = type // 'telegram' or 'cli'
        this.chatId = chatId
        this.bot = bot
        this.lastMessageId = null
    }

    async sendMessage(message, options = {}) {
        if (this.type === 'telegram' && this.bot && this.chatId) {
            const sentMsg = await this.bot.sendMessage(this.chatId, message, options)
            this.lastMessageId = sentMsg.message_id
            return sentMsg
        } else if (this.type === 'cli') {
            console.log(message)
        }
    }

    async sendDocument(document, options = {}) {
        if (this.type === 'telegram' && this.bot && this.chatId) {
            return await this.bot.sendDocument(this.chatId, document, options)
        } else if (this.type === 'cli') {
            console.log(`[Document would be sent: ${options.caption || 'No caption'}]`)
        }
    }
}

// Global variables
let infiniteTraining = false
let studios = {}

// Command handler functions
async function handleListCommand(sender) {
    let textToSend = "<b>List of available studios:</b>\n\n"
    for (let i = 0; i < Object.keys(studios).length; i++){
        textToSend += `${i + 1}. <code>${Object.keys(studios)[i]}</code>\n`
    }
    await sender.sendMessage(textToSend, { parse_mode: 'HTML' })
}

async function handleStopSingleCommand(sender, studioName) {
    const params = { 
        action: "stop_single", 
        credentials: JSON.stringify(studios[studioName])
    }
    
    try {
        const result = await runPythonScript("./studioManager.py", params, true)
        await sender.sendMessage(`Studio ${studioName} stopped:\n${result}`)
    } catch (error) {
        await sender.sendMessage(`Error stopping studio ${studioName}:\n${error}`)
    }
}

async function handleStopAllCommand(sender) {
    await sender.sendMessage(`Stopping all studios...`)
    for(let i = 0; i < Object.keys(studios).length; i++){
        const params = { 
            action: "stop_single", 
            credentials: JSON.stringify(studios[Object.keys(studios)[i]])
        }
        
        try {
            const result = await runPythonScript("./studioManager.py", params, true)
            await sender.sendMessage(`Stopped ${studios[Object.keys(studios)[i]].user}:\n${result}`)
        } catch (error) {
            await sender.sendMessage(`Error stopping ${studios[Object.keys(studios)[i]].user}:\n${error}`)
        }
    }
}

async function handleStatusCommand(sender, studioName) {
    const params = { 
        action: "status_single", 
        credentials: JSON.stringify(studios[studioName]) 
    }
    
    try {
        const result = await runPythonScript("./studioManager.py", params, true)
        await sender.sendMessage(`Status of ${studioName}:\n${result}`)
    } catch (error) {
        await sender.sendMessage(`Error getting status of ${studioName}:\n${error}`)
    }
}

async function handleStatusAllCommand(sender) {
    for(let i = 0; i < Object.keys(studios).length; i++){
        const params = { 
            action: "status_single", 
            credentials: JSON.stringify(studios[Object.keys(studios)[i]])
        }
        
        try {
            const result = await runPythonScript("./studioManager.py", params, true)
            await sender.sendMessage(`Status of ${studios[Object.keys(studios)[i]].user}:\n${result}`)
        } catch (error) {
            await sender.sendMessage(`Error getting status of ${studios[Object.keys(studios)[i]].user}:\n${error}`)
        }
    }
}

async function handleTrainSingleCommand(sender, parts, text) {
    const forceNewRun = text.toLowerCase().includes("force_new_run")
    let forceConfig = null
    
    if (text.toLowerCase().includes("force_config")) {
        forceConfig = text.split("force_config")[1].trim()
    }

    let limit = 1
    if(parts.includes("forever")){
        limit = Infinity
    }

    let i = 0
    while(i < limit){
        
        // if(parts.includes("clean_start")) {
        //     // Clean start, stop the studio first
        //     const stopParams = { 
        //         action: "stop_single", 
        //         credentials: JSON.stringify(studios[parts[1]])
        //     }
        //     await runPythonScript("./studioManager.py", stopParams, true)
        // }

        const params = forceConfig 
            ? { 
                action: "train_single", 
                credentials: JSON.stringify(studios[parts[1]]), 
                forceConfig: true,
                config: forceConfig
            }
            : { 
                action: "train_single", 
                credentials: JSON.stringify(studios[parts[1]]), 
                forceNewRun: forceNewRun
            }
    
        await sender.sendMessage(`Starting training for ${parts[1]} (run ${i})...`)
        
        // Don't wait for answers
        runPythonScript("./studioManager.py", params, true)
            .then((result) => sender.sendMessage(`Started training ${parts[1]}:\n${result}`))
            .catch((error) => sender.sendMessage(`Error training ${parts[1]}:\n${error}`))
        
        limit++
        await new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000))
    }
}

async function handleTrainingStatCommand(sender, studioName) {
    const params = { 
        action: "training_stat", 
        credentials: JSON.stringify(studios[studioName])
    }
    
    try {
        const result = await runPythonScript("./studioManager.py", params, true)
        await sender.sendMessage(`Training status of ${studioName}:\n${result}`)
    } catch (error) {
        await sender.sendMessage(`Error getting training status of ${studioName}:\n${error}`)
    }
}

async function handleUploadAllResultsCommand(sender, studioName) {
    const params = { 
        action: "upload_all_results", 
        credentials: JSON.stringify(studios[studioName])
    }
    
    try {
        const result = await runPythonScript("./studioManager.py", params, true)
        
        const splittedText = result.split("||||")
        const dir = splittedText[splittedText.length - 1].trim()

        if (existsSync(dir)) {
            const files = await fs.readdir(dir)
            for (let i = 0; i < files.length; i++) {
                await sender.sendDocument(`${dir}/${files[i]}`, { caption: `Results ${i + 1}/${files.length}` })
            }
        } else {
            await sender.sendMessage(`Directory not found: ${dir}`)
        }
    } catch (error) {
        await sender.sendMessage(`Error uploading results from ${studioName}:\n${error}`)
    }
}

async function handleStopTrainingCommand(sender) {
    infiniteTraining = false
    await sender.sendMessage(`Stopping training loop...`)
}

async function handleTrainMultipleCommand(sender, parts, text) {
    const forceNewRun = text.toLowerCase().includes("force_new_run")
    const studioNames = parts.slice(1).filter(p => p !== "force_new_run")
    
    infiniteTraining = true
    while(infiniteTraining){
        for(let i = 0; i < studioNames.length; i++){

            if(parts.includes("clean_start")) {
                // Clean start, stop the studio first
                const stopParams = { 
                    action: "stop_single", 
                    credentials: JSON.stringify(studios[studioNames[i]])
                }
                
                runPythonScript("./studioManager.py", stopParams, true)
            }

            const params = { 
                action: "train_single", 
                credentials: JSON.stringify(studios[studioNames[i]]), 
                forceNewRun: forceNewRun
            }
            
            runPythonScript("./studioManager.py", params, true)
            await new Promise(resolve => setTimeout(resolve, 1000))
            await sender.sendMessage(`Starting training for ${studioNames[i]}...`)
            await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
        }

        await sender.sendMessage(`All specified studios started. Waiting 4 hours before next training round...`)
        await new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000))
    }
}

async function handleTrainAllCommand(sender, text) {
    await sender.sendMessage(`Starting training for all studios (0/${Object.keys(studios).length}) ...`)
    
    let forceNewRun = text.toLowerCase().includes("force_new_run")

    for(let i = 0; i < Object.keys(studios).length; i++){
        const params = { 
            action: "train_single", 
            credentials: JSON.stringify(studios[Object.keys(studios)[i]]), 
            forceNewRun: forceNewRun
        }
        
        runPythonScript("./studioManager.py", params, true)
        await new Promise(resolve => setTimeout(resolve, 1000))
        await sender.sendMessage(`Starting training for ${studios[Object.keys(studios)[i]].user} (${i + 1}/${Object.keys(studios).length})...`)
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
    }
}

async function handleTuneGridSearchCommand(sender, text) {
    let tuningParams = await readJsonFile("./tune_params.json")

    if (tuningParams.tune) {
        tuningParams.tuning = { compact: {}, unassigned: [], assigned: {}, finished: [] }
        tuningParams.tuning.compact = flattenTuningOptionsToSpec(tuningParams.tune)
        tuningParams.tuning.unassigned = generateIndexCombos(tuningParams.tuning.compact)

        for (let i = 0; i < Object.keys(studios).length; i++){
            tuningParams.tuning.assigned[Object.keys(studios)[i]] = []
        }

        tuningParams.tuning.finished = []
        
        await saveJSONFile("./tune_params.json", tuningParams)
    }

    let forceNewRun = false
    if(text.toLowerCase().includes("force_new_run")){ forceNewRun = true }

    infiniteTraining = true
    while(infiniteTraining) {
        await sender.sendMessage(`Starting training for all studios (0/${Object.keys(studios).length}) ...`)
        let i = 1
        for(let i = 0; i < Object.keys(studios).length; i++){
            try{
                let name = Object.keys(studios)[i]
                console.log("===== new studio =====\nName:", name)
                tuningParams =  await readJsonFile("./tune_params.json")

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
                        const params = { 
                            action: "train_single", 
                            credentials: JSON.stringify(studios[name]), 
                        }
                        runPythonScript("./studioManager.py", params, true)
                        await new Promise(resolve => setTimeout(resolve, 1000))
                        await sender.sendMessage(`Starting studio ${studios[name].user} for training `)
                    } else if(result.includes("true: finished duplicate found")) {
                        console.log(name, "finished run found")
                        tuningParams.tuning.finished.push(tuningParams.tuning.assigned[name][0])
                        tuningParams.tuning.assigned[name] = []
                        await saveJSONFile("./tune_params.json", tuningParams)

                        i = i -1
                    } else if(result.includes("false: no duplicates found")) {
                        await sender.sendMessage(`Error 1 when running config for ${name}: ${result}`)
                    } else {
                        await sender.sendMessage(`Error 2 when running config for ${name}: ${result}`)
                    }
                } else {
                    while(true){
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
                            const _idx = getRandomInt(0, tuningParams.tuning.unassigned.length)
                            const _combination = tuningParams.tuning.unassigned[_idx]
                            if (_idx != -1) {tuningParams.tuning.unassigned.splice(_idx, 1)}
                            tuningParams.tuning.finished.push(_combination)
                            await saveJSONFile("./tune_params.json", tuningParams)
                            
                            i = i -1
                            break
                        } else if (result.includes("false: unfinished duplicate found")){
                            const params = { 
                                action: "train_single", 
                                credentials: JSON.stringify(studios[name]), 
                                forceNewRun: forceNewRun
                            }
                            runPythonScript("./studioManager.py", params, true)
                            await new Promise(resolve => setTimeout(resolve, 1000))
                            await sender.sendMessage(`Starting studio ${studios[name].user} for training `)
                            break
                        } else if ("false: no duplicates found") {
                            console.log(name, "starting a new run")
                            tuningParams.tuning.unassigned.splice(_idxMain, 1)
                            tuningParams.tuning.assigned[name] = [_combination]
                            await saveJSONFile("./tune_params.json", tuningParams)

                            const params = { 
                                action: "train_single", 
                                credentials: JSON.stringify(studios[name]), 
                                forceConfig: true,
                                config: JSON.stringify(config)
                            }
                            
                            runPythonScript("./studioManager.py", params, true)
                            await new Promise(resolve => setTimeout(resolve, 1000))
                            await sender.sendMessage(`Starting studio ${studios[name].user} for training `)
                            break
                        }

                    }
                }

                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
                console.log("finished one run")
            } catch (err) {
                await sender.sendMessage("******** ERROR ********")
                await sender.sendMessage(studios[Object.keys(studios)[i]])
                
                console.log("******** ERROR ********")
                console.log(studios[Object.keys(studios)[i]])
                console.log(err)
                await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
            }
        }

        forceNewRun = false
        await sender.sendMessage(`All studios started for training. Waiting 4 hours before next training round...`)

        await new Promise(resolve => setTimeout(resolve, 4 * 60 * 60 * 1000))
    }
}

async function handleHelpCommand(sender) {
    const textToSend = "<b>Help: </b>\n\n" +
    "- <code>list</code>: <i>Lists all available studios </i>\n" +
    "- <code>stop single studio_name</code>: <i>Stops the specified studio </i>\n" +
    "- <code>stop_all</code>: <i>Stops all running studios </i>\n" +
    "- <code>status studio_name</code>: <i>Gets the status of the specified studio </i>\n" +
    "- <code>status_all</code>: <i>Gets the status of all studios </i>\n" +
    "- <code>train_all</code>: <i>Starts training for all studios (with 5 minutes delay between each start)  </i> \n" +
    "- <code>train_all force_new_run</code>: <i>Starts training for all studios with a forced new run in each server </i> \n" +
    "- <code>train_multiple studio_1 studio_2 ... force_new_run</code>: <i>Runs multiple studios in a loop, force_new_run is optional </i> \n" +
    "- <code>train_single studio_name optional:force_new_run</code>: <i>Starts training a specific studio </i> \n" +
    "- <code>train_single studio_name optional:force_config {config}</code>: <i>Starts training a specific studio, forcing a specific configuration </i> \n" +
    "- <code>stop_training</code>: <i>Stops further initiations of training </i> \n" +
    "- <code>training_stat studio_name</code> : <i>Gets the training status of the specified studio </i>\n" +
    "- <code>upload_all_results studio_name</code> : <i>Uploads all results from a specific studio in separate zip files </i>\n" +
    "- <code>tune_grid_search</code> : <i>Tunes algorithm parameters using grid search</i>\n"

    await sender.sendMessage(textToSend, { parse_mode: 'HTML' })
}

// Main command processor
async function processCommand(text, sender) {
    const parts = text.split(" ")

    if (parts[0] === "list") {
        await handleListCommand(sender)
    } else if (parts[0] === "stop" && parts[1] === "single" && parts[2]) {
        await handleStopSingleCommand(sender, parts[2])
    } else if (text === "stop_all") {
        await handleStopAllCommand(sender)
    } else if (parts[0] === "status" && parts[1] && parts[1] !== "all") {
        await handleStatusCommand(sender, parts[1])
    } else if (text === "status_all") {
        await handleStatusAllCommand(sender)
    } else if (parts[0] === "train_single" && parts[1]) {
        await handleTrainSingleCommand(sender, parts, text)
    } else if (parts[0] === "training_stat" && parts[1]) {
        await handleTrainingStatCommand(sender, parts[1])
    } else if (parts[0] === "upload_all_results" && parts[1]) {
        await handleUploadAllResultsCommand(sender, parts[1])
    } else if (text === "stop_training") {
        await handleStopTrainingCommand(sender)
    } else if (parts[0] === "train_multiple" && parts.length >= 2) {
        await handleTrainMultipleCommand(sender, parts, text)
    } else if (parts[0] === "train_all") {
        await handleTrainAllCommand(sender, text)
    } else if (parts[0] === "tune_grid_search") {
        await handleTuneGridSearchCommand(sender, text)
    } else {
        await handleHelpCommand(sender)
    }
}

// Main initialization
async function main() {
    config()
    
    // Load studios
    studios = await readJsonFile("./studios.json")

    // Check if CLI arguments are provided
    const args = process.argv.slice(2)
    
    if(args.length === 0){
        console.log("Please provide a flag for running the app (--telegram or --cli)")
        process.exit()
    }

    if (args[0] === "--cli") {
        // CLI mode
        console.log("Running in CLI mode...")
        const command = args.join(" ")
        const sender = new MessageSender('cli')
        
        try {
            await processCommand(command, sender)
            console.log("\nCommand completed.")
            process.exit(0)
        } catch (error) {
            console.error("Error executing command:", error)
            process.exit(1)
        }
    } else if (args[0] === "--telegram") {
        // Telegram bot mode
        console.log("Running in Telegram bot mode...")

        // CHeck if bot's token exists
        if(!process.env.TELEGRAM_BOT_TOKEN) {
            console.log("TELEGRAM_BOT_TOKEN environment variable not provided")
            process.exit()
        }

        const token = process.env.TELEGRAM_BOT_TOKEN
        const bot = new TelegramBot(token, { polling: true })

        bot.on("message", async (msg) => {
            const chatId = msg.chat.id
            const text = msg.text
            const sender = new MessageSender('telegram', chatId, bot)
            
            await processCommand(text, sender)
        })

        console.log("Telegram bot is running...")
    }
}

// Start the application
try {
    main()
} catch (error) {
    console.log(`Ran into errors: ${error}`)
}