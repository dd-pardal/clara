# C.L.A.R.A.

If you’re here, you probably know what this is, so I won’t bother explaining it.

## Running the code yourself

The main purpose of this repository is for satisfying people’s curiosity about how C.L.A.R.A. works and to help others making similar applications. However, since C.L.A.R.A. is free software, you are free to run it on your machine, provided you follow the terms and conditions in the license. However, the code in this repo needs some prerequisites to run, including:

- An SQLite database with the right tables and columns,
- JSON data representing the configuration (stored in the database),
- A Discord bot account with the right slash commands and
- A Twitter developer account (application necessary).

These requirements are not optional and if you want to run C.L.A.R.A. without going through the hassle of satisfying all of them, you’ll need to edit the code yourself to remove its dependency on them.

### Instructions

#### Setup

- Install Node.js and NPM on your system (instructions at https://nodejs.org/). The recommended Node.js version is 16.
- Clone/download this repository to a direcroty.
- With that directory as the current working directory, run `npm install` to install all depedencies.

#### Compilation instructions

- Run `npm run build` or `npx tsc`.

#### Configuration

Good luck.

#### Run instructions

- Run `npm run run` or `node ./build/index.js`.

### Copyright notice

Copyright © 2021 D. Pardal <dd_pardal@outlook.pt>

This program is free software: you can redistribute it and/or modify it under the terms of version 3 of the GNU Affero General Public License as published by the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You may find a copy of the license in the [`LICENSE` file](https://github.com/dd-pardal/clara/blob/main/LICENSE).
