# Add custom API routes, using router
from aiohttp import web
from server import PromptServer
import logging
import execution

# import json
import uuid

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

__version__ = "0.0.1"

from .src.comfyui_queue_manager.nodes import NODE_CLASS_MAPPINGS
from .src.comfyui_queue_manager.nodes import NODE_DISPLAY_NAME_MAPPINGS


@PromptServer.instance.routes.get("/hello")
async def get_hello(request):
    return web.json_response("hello")


# When a valid prompt is received then create a shadow copy of the prompt in the persistent queue
# Note: Right now the only reliable way to get the queue item data is to use the prompt data, validate and create it ourselves the same way "/prompt" handler does
#       There are no hooks to reliably and cheaply match the queue item with invoking workflow file after the prompt was added to the queue
#       This code might need to be adjusted in the future if the "/prompt" handler changes the way it determines validity of the prompt
# We add "queue_manager_shadow_id" to the prompt data so we can later identify the queue item in the persistent queue
def create_prompt_shadow(json_data):
    if "number" in json_data:
        number = float(json_data["number"])
    else:
        number = PromptServer.instance.number
        if "front" in json_data:
            if json_data["front"]:
                number = -number

    if "prompt" in json_data:
        prompt = json_data["prompt"]
        valid = execution.validate_prompt(prompt)
        extra_data = {}
        if "extra_data" in json_data:
            extra_data = json_data["extra_data"]

        if "client_id" in json_data:
            extra_data["client_id"] = json_data["client_id"]
        if valid[0]:
            # outputs_to_execute = valid[2]
            # response = {
            #     "number": number,
            #     "node_errors": valid[3],
            #     "prompt": prompt,
            #     "extra_data": extra_data,
            #     "outputs_to_execute": outputs_to_execute,
            # }
            # json to string
            # json_data_string = json.dumps(response)
            # add queue_manager_shadow_id to the prompt data
            json_data["extra_data"]["queue_manager_shadow_id"] = str(uuid.uuid4())
            logging.info("Received valid prompt data. Shadow ID: " + json_data["queue_manager_shadow_id"])

        return json_data


PromptServer.instance.add_on_prompt_handler(create_prompt_shadow)


WEB_DIRECTORY = "./web"
