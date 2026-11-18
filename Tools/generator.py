import os
import json


PROJECT_ROOT = os.path.dirname(
    os.path.dirname(
        os.path.abspath(__file__)
    )
)


DATA_PATH = os.path.join(
    PROJECT_ROOT,
    "Website",
    "data"
)


ITEMS_FILE = os.path.join(
    DATA_PATH,
    "items.json"
)


OVERRIDE_FILE = os.path.join(
    DATA_PATH,
    "overrides.json"
)


OUTPUT_FILE = os.path.join(
    DATA_PATH,
    "database.json"
)



def load_json(path):

    if not os.path.exists(path):
        return {}

    with open(
        path,
        "r",
        encoding="utf-8"
    ) as f:

        return json.load(f)




def apply_override(items, overrides):

    for item in items:

        item_id = item.get("id")


        if item_id in overrides:

            changes = overrides[item_id]


            for key, value in changes.items():

                item[key] = value


    return items





def generate():

    print(
        "Generating Armory Database..."
    )


    items = load_json(
        ITEMS_FILE
    )


    overrides = load_json(
        OVERRIDE_FILE
    )


    items = apply_override(
        items,
        overrides
    )


    with open(
        OUTPUT_FILE,
        "w",
        encoding="utf-8"
    ) as f:


        json.dump(
            items,
            f,
            indent=4,
            ensure_ascii=False
        )


    print(
        "Created:",
        OUTPUT_FILE
    )


    print(
        "Total items:",
        len(items)
    )





if __name__ == "__main__":

    generate()