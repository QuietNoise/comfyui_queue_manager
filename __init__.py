# Add custom API routes, using router
from aiohttp import web
from server import PromptServer
import logging
import json
import os
import heapq

# import json
# import uuid

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.nodes import NODE_CLASS_MAPPINGS
from .src.comfyui_queue_manager.nodes import NODE_DISPLAY_NAME_MAPPINGS


# Save shadow copy of the queue and return it to the client
@PromptServer.instance.routes.get("/queue_manager/queue")
async def get_queue(request):
    theServer = PromptServer.instance
    theQueue = theServer.prompt_queue

    # pending items
    pending = theQueue.queue

    with theQueue.mutex:
        running = []
        for x in theQueue.currently_running.values():
            running += [x]

        queue = running + pending

    # Get this script's directory
    current_directory = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_directory, "queue.json")
    with open(file_path, "w") as f:
        json.dump(queue, f, indent=4)

    # Return the queue object as JSON
    return web.json_response({"running": running, "pending": pending})


# Restore the queue from the shadow copy if queue.json is not empty
@PromptServer.instance.routes.get("/queue_manager/restore")
async def restore_queue(request):
    # Get this script's directory
    current_directory = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(current_directory, "queue.json")
    if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
        with open(file_path, "r") as f:
            queue = json.load(f)
            # Check if the queue is empty
            if len(queue) == 0:
                logging.info("[Queue Manager] Shadow queue is empty.")
                return web.json_response({"status": "success", "message": "Queue Manage shadow queue is empty."})

            # SIML: Check if all prompts in the queue are valid
            theServer = PromptServer.instance
            theQueue = theServer.prompt_queue
            with theQueue.mutex:
                queue = [tuple(item) for item in queue]  # Convert to tuples - format expected by queue in PromptQueue
                theQueue.queue = queue
                heapq.heapify(theQueue.queue)
                theServer.queue_updated()
                theQueue.not_empty.notify()

            logging.info("[Queue Manager] Queue restored from shadow copy. Queue size: %d", len(queue))
            return web.json_response({"status": "success", "message": "Queue restored from shadow copy."})
    else:
        logging.info("[Queue Manager] No shadow copy of the queue found.")
        return web.json_response({"status": "success", "message": "No shadow copy found."})


# Endpoint to expose __version__ information
@PromptServer.instance.routes.get("/queue_manager/version")
async def get_version(request):
    # Return the version as JSON
    return web.json_response({"version": __version__})


# When the server is fully started, restore the queue from the shadow copy
async def on_ready(app):
    # TODO: Add a setting to enable/disable this feature
    await restore_queue(None)


PromptServer.instance.app.on_startup.append(on_ready)


# v 1 Attempt
# When a valid prompt is received then create a shadow copy of the prompt in the persistent queue
# Note: Right now the only reliable way to get the queue item data is to use the prompt data, validate and create it ourselves the same way "/prompt" handler does
#       There are no hooks to reliably and cheaply match the queue item with invoking workflow file after the prompt was added to the queue
#       This code might need to be adjusted in the future if the "/prompt" handler changes the way it determines validity of the prompt
# We add "queue_manager_shadow_id" to the prompt data so we can later identify the queue item in the persistent queue
# def create_prompt_shadow(json_data):
#     if "number" in json_data:
#         number = float(json_data["number"])
#     else:
#         number = PromptServer.instance.number
#         if "front" in json_data:
#             if json_data["front"]:
#                 number = -number
#
#     if "prompt" in json_data:
#         prompt = json_data["prompt"]
#         valid = execution.validate_prompt(prompt)
#         extra_data = {}
#         if "extra_data" in json_data:
#             extra_data = json_data["extra_data"]
#
#         if "client_id" in json_data:
#             extra_data["client_id"] = json_data["client_id"]
#         if valid[0]:
#             # outputs_to_execute = valid[2]
#             # response = {
#             #     "number": number,
#             #     "node_errors": valid[3],
#             #     "prompt": prompt,
#             #     "extra_data": extra_data,
#             #     "outputs_to_execute": outputs_to_execute,
#             # }
#             # json to string
#             # json_data_string = json.dumps(response)
#             # add queue_manager_shadow_id to the prompt data
#             json_data["extra_data"]["queue_manager_shadow_id"] = str(uuid.uuid4())
#             logging.info("Received valid prompt data. Shadow ID: " + json_data["queue_manager_shadow_id"])
#
#         return json_data

# v 2 Attempt
# Inject our own shadow ID into the prompt data and broadcast it
# When queue is updated successfully we will check if the prompt data has our shadow ID and if it does we will create a shadow copy of the final version of the queue item
# def create_prompt_shadow(json_data):
#   if "prompt" in json_data:
#       extra_data = {}
#       if "extra_data" in json_data:
#           extra_data = json_data["extra_data"]
#
#       if "client_id" in json_data:
#           extra_data["queue_manager_shadow_id"] = str(uuid.uuid4())
#           json_data["extra_data"] = extra_data
#           logging.info("Received valid prompt data. Shadow ID: " + extra_data["queue_manager_shadow_id"] + ", Front: " + str("front" in json_data))
#
#
#
# PromptServer.instance.add_on_prompt_handler(create_prompt_shadow)


WEB_DIRECTORY = "./web"
