# User Guide: Disaster Response Coordinator

This guide explains, step by step and in everyday words, how to set up the platform on your own computer
and how to use every screen and button. You do not need any technical background.

**Contents**

- [Part A: Setting it up on your computer](#part-a-setting-it-up-on-your-computer)
- [Part B: The basics (words, colours, logging in)](#part-b-the-basics)
- [Part C: Guide for the Commander](#part-c-guide-for-the-commander)
- [Part D: Guide for the Admin](#part-d-guide-for-the-admin)
- [Part E: Guide for the Field Responder](#part-e-guide-for-the-field-responder)
- [Part F: Common messages and what to do](#part-f-common-messages-and-what-to-do)
- [Part G: Frequently asked questions](#part-g-frequently-asked-questions)

---

## What is this platform?

During a disaster such as a flood, a control room receives hundreds of messages: phone calls, social media
posts, alerts. Many of them describe the same event. This platform helps the control room:

1. **Collect** every report in one place.
2. **Understand** each report automatically: what happened and how serious it is.
3. **Group** reports about the same event into one **incident**.
4. **Sort** incidents so the most urgent one is always at the top.
5. **Suggest** the best ambulance, rescue team or supply truck to send, with the real travel time by road
   and a reason anyone can read.
6. **Keep a person in charge.** Nothing is sent without a commander clicking a button.
7. **Record** every decision, by the computer and by people, with the time.

The demo uses a flood scenario in **Chennai**. All people, vehicles and social media posts in it are made up.

### The three kinds of users

| User | Who they are | What they do on the platform |
|---|---|---|
| **Commander** | Control room staff in charge | Watches incidents, checks the computer's suggestions, sends units, closes incidents |
| **Admin** | The person who manages equipment and vehicles | Adds, edits and retires ambulances, teams, trucks and shelters; can view the dashboard |
| **Field Responder** | Ambulance crew, rescue team member, truck driver | Sees their own unit and whether it has been sent somewhere |

---

# Part A: Setting it up on your computer

Follow this part once, the first time. It takes about 30–45 minutes, mostly waiting for downloads.
The steps are written for **Windows**, which is what the project was built and tested on.

## A1. What you need

- A computer with Windows 10 or 11, at least 8 GB of RAM, and about 3 GB of free disk space
- An internet connection (the map, road routes and address search come from the internet)
- A modern browser: Google Chrome, Microsoft Edge or Firefox

## A2. Install the four programs (one time only)

### 1) Node.js (runs the platform)

1. Go to **https://nodejs.org**.
2. Download the version marked **LTS** (version 24 was used to build this project).
3. Open the downloaded file and click **Next** on every screen, keeping the default options.
4. To check: open the **Command Prompt** (press the Windows key, type `cmd`, press Enter), type
   `node --version` and press Enter. You should see something like `v24.x.x`.

### 2) Git (downloads the code from GitHub, optional)

You only need Git if you want to download the code with a command. You can also download a ZIP file
instead (see A3).

1. Go to **https://git-scm.com/downloads** and download Git for Windows.
2. Install it, keeping the default options.

### 3) PostgreSQL 17 (the database that stores everything)

1. Go to **https://www.postgresql.org/download/windows/** and click the link to download the installer.
2. Choose **version 17** for Windows x86-64.
3. Run the installer:
   - Keep all components ticked (PostgreSQL Server, pgAdmin 4, Stack Builder, Command Line Tools).
   - When asked for a **password**, type one you will remember (for example `postgres`) and **write it
     down**. You will need it in step A5.
   - Keep the port as **5432**.
   - Keep everything else as default and finish.

### 4) PostGIS (adds map and distance features to the database)

At the end of the PostgreSQL installation, a program called **Stack Builder** offers to open. If it does
not, open it from the Start menu (search "Stack Builder").

1. In Stack Builder, choose **PostgreSQL 17 on port 5432** and click **Next**.
2. Open **Spatial Extensions** and tick **PostGIS 3.x Bundle for PostgreSQL 17**.
3. Click **Next**, let it download, then install it, keeping the default options. If it asks whether to
   create a sample database, you can say no.

## A3. Get the code

**Option 1: download a ZIP (easiest)**

1. Open the project's page on GitHub.
2. Click the green **Code** button, then **Download ZIP**.
3. Right-click the downloaded file, choose **Extract All**, and pick a simple place such as
   `D:\Minor Project`.

**Option 2: with Git**

Open the Command Prompt and type (replace the address with the project's GitHub address):

```
git clone https://github.com/<owner>/<repository>.git "D:\Minor Project"
```

## A4. Create the empty database

1. Open **pgAdmin 4** from the Start menu.
2. On the left, click **Servers**, then **PostgreSQL 17**. Enter the password you chose in step A2.
3. Right-click **Databases**, choose **Create → Database...**
4. In **Database**, type `drrc` (all small letters) and click **Save**.

You do not need to create any tables. The platform does that by itself in step A6.

## A5. Fill in the settings file

The settings file is not included in the download, for safety. You create it from a template.

1. Open the project folder, then the **server** folder.
2. Find the file **`.env.example`**, copy it, and paste it in the same folder.
3. Rename the copy to exactly **`.env`** (a dot followed by env, nothing else).
   - If Windows hides file endings, tick **View → File name extensions** in File Explorer first, so the file
     does not end up named `.env.txt`.
4. Open `.env` with Notepad or VS Code and change these lines:

| Line | What to put |
|---|---|
| `DATABASE_URL=postgres://postgres:postgres@localhost:5432/drrc` | Replace the **second** `postgres` (the one just before the `@`) with your PostgreSQL password from step A2. If your password is `postgres`, leave the line as it is. |
| `JWT_SECRET=change-this-to-a-long-random-string` | Replace the text after `=` with any long random mix of letters and numbers, at least 16 characters. This keeps logins secure. |
| `GEMINI_API_KEY=` | Optional. Leave empty for now. See step A8 to turn on the AI. |

5. Save the file.

## A6. Install and prepare (one time)

1. Open the **Command Prompt** in the project folder. A quick way: open the folder in File Explorer, click
   the address bar at the top, type `cmd` and press Enter.
2. Type this and press Enter. It downloads the libraries the platform needs and takes a few minutes:

   ```
   npm run setup
   ```

3. Then type this and press Enter. It creates the tables and loads the Chennai demo data:

   ```
   npm run db:reset
   ```

   At the end you should see `Seeded 33 resources and 6 users.` and a list of logins.

## A7. Start the platform

In the same Command Prompt, type:

```
npm run dev
```

After a few seconds you will see lines beginning with **[server]** and **[client]**, including
`running on http://localhost:4000` and `Local: http://localhost:5173/`.

Now open your browser and go to **http://localhost:5173**. You will see the login page.

- **Keep the Command Prompt window open** while you use the platform. Closing it stops the platform.
- **To stop:** click the Command Prompt window, press **Ctrl + C**, then type **Y** and press Enter if it
  asks "Terminate batch job?".
- **Next time:** you only need `npm run dev`. Run `npm run db:reset` first if you want a fresh start with the
  original demo data.

## A8. Turn on the AI (optional, recommended)

Without an AI key, the platform still works. It understands reports using simple keyword matching and marks
every new incident "Needs checking". With a free Google Gemini key, it understands reports much better.

1. Go to **https://aistudio.google.com/apikey** and sign in with a Google account.
2. Accept the terms if asked. A key is often created for you automatically; otherwise click
   **Create API key**.
3. If the key is labelled "Unrestricted", click **Add restrictions** and choose the Gemini API.
4. Copy the key and paste it into `server/.env` after `GEMINI_API_KEY=` (no spaces, no quotation marks).
   Save the file.
5. In the Command Prompt, stop the platform (Ctrl + C) and type:

   ```
   npm run ai:check
   ```

   `SUCCESS` means the key works. `FAILED` shows the reason (see the troubleshooting table in Part F).
6. Start the platform again with `npm run dev`.

Keep the key private, like a password. Never share it in chats or screenshots.

---

# Part B: The basics

## B1. Words used on the screens

| Word | Meaning |
|---|---|
| **Report** | One message about a problem: a phone call, a social media post. |
| **Incident** | One real event (for example, "flooding in Velachery"). Several reports can belong to one incident. |
| **Unit** | Something that can be sent to help: an ambulance, a response team or a supply truck. |
| **Shelter** | A relief camp where people can stay. Shelters are shown on the map but are never sent anywhere. |
| **Severity** | How serious the incident is: Minor, Moderate, Serious, Severe or Critical. |
| **Priority score** | A number from 0 to 100. Higher means more urgent. The platform always explains how it was worked out. |
| **Triage** | Automatically reading a report to decide what kind of incident it is and how serious it is. |
| **Suggested unit** | The unit the platform recommends sending, with a reason. |
| **Override** | When the commander decides to send a different unit from the one suggested. |
| **Needs checking** | The platform is not sure about its reading of a report, so a person should look at it. |
| **History** | The record of everything that happened to an incident, by the computer and by people, with times. |

## B2. Colours

**Incidents** (circles on the map, coloured strip on the left of each incident card):

| Colour | Severity |
|---|---|
| Dark red | Critical |
| Orange | Severe |
| Mustard yellow | Serious |
| Green | Moderate |
| Grey | Minor |

A **bigger circle** means more reports about the same event.

**Units** (small squares on the map, coloured dot next to each unit):

| Colour | Status |
|---|---|
| Green | Available (free to be sent) |
| Blue | On the way |
| Purple | On scene (arrived) |
| Grey | Out of service |

The letter inside each square tells you the kind of unit:
**A** = ambulance, **T** = response team, **S** = supply truck, **H** = shelter.

## B3. Logging in

1. Open **http://localhost:5173**.
2. Type your **Email** and **Password** and click **Sign in**.
3. While the platform runs in demo mode, the login page shows **"Demo accounts (click to fill in)"**.
   Clicking **Commander**, **Admin** or **Field responder** fills in the details for you.

Demo accounts:

| User | Email | Password |
|---|---|---|
| Commander | commander@drrc.local | Commander@123 |
| Admin | admin@drrc.local | Admin@123 |
| Field responder (Ambulance AMB-01) | responder1@drrc.local | Responder@123 |
| Field responder (Fire team FIRE-01) | responder2@drrc.local | Responder@123 |
| Field responder (Boat team BOAT-01) | responder3@drrc.local | Responder@123 |
| Field responder (Supply truck TRK-01) | responder4@drrc.local | Responder@123 |

After signing in, each user lands on their own starting page:
Commander → **Dashboard**, Admin → **Resources**, Field responder → **My unit**.

## B4. The top bar (on every page)

- **Left:** the platform name.
- **Middle:** the pages you are allowed to open. The current page is underlined in blue.
- **Right:**
  - **Live** with a green dot: the screen is receiving updates instantly. You never need to refresh.
  - **Reconnecting...** in orange: the connection dropped for a moment. It reconnects by itself and then
    reloads the latest information.
  - Your **name** and **role**.
  - **Log out**: signs you out.

If you stay logged in for more than 12 hours, the platform asks you to log in again with the message
"Your session has expired. Please log in again."

---

# Part C: Guide for the Commander

The commander sees two pages in the top bar: **Dashboard** and **Log a report**.

## C1. The Dashboard at a glance

The dashboard has three columns:

```
┌────────────────────┬───────────────────────────────┬─────────────────────┐
│ Social media feed  │                               │                     │
│ ────────────────── │            MAP                │  Units overview     │
│ Active incidents   │   incidents = circles         │       or            │
│ (most urgent first)│   units = lettered squares    │  Incident details   │
│                    │                               │  (when you click    │
│                    │                               │   an incident)      │
└────────────────────┴───────────────────────────────┴─────────────────────┘
```

On smaller screens the right column moves below the other two. On a phone, everything is stacked from top
to bottom.

## C2. The social media feed (to simulate a disaster)

At the top-left is the **Social media feed** box. It replays 26 made-up posts from people in Chennai during a
flood, one every 5 seconds, as if they were arriving live.

| Button | What it does |
|---|---|
| **Start** | Begins receiving posts. The text shows "Receiving posts... 3 of 26". |
| **Pause** | Stops receiving posts for now. |
| **Resume** | Continues from where it paused. |
| **Reset** | Goes back to the first post (posts already received stay on the dashboard). |
| **Replay** | After all 26 are received, plays them again from the start. |

Each post goes through the same steps as a real report: it is read, sorted, and either added to an existing
incident or turned into a new one.

If you see the note *"Automatic classification is in basic mode (keyword rules), so every new incident is
marked for checking"*, the AI key has not been set up (Part A, step A8). Everything still works.

## C3. The list of active incidents

Below the feed is **Active incidents**, with the total number in brackets. The most urgent incident is
always at the top, and the list re-sorts itself whenever something changes.

**Reading an incident card:**

```
 1  [Critical]  Flooding                              87
 Water entered our street in Velachery, almost waist deep now.
 Velachery, Chennai · 4 min ago · 3 reports
 Waiting for a unit   [Needs checking]   [Unit suggested]
```

| Part | Meaning |
|---|---|
| `1` | Position in the queue |
| `[Critical]` | Severity |
| `Flooding` | Type of incident |
| `87` | Priority score out of 100. Hold your mouse over it to see how it was calculated. |
| Second line | Short description from the first report |
| `Velachery, Chennai · 4 min ago · 3 reports` | Where, when it was first reported, and how many reports describe it |
| Status (coloured text) | **Waiting for a unit** (red), **Unit on the way: BOAT-02** (blue), **Unit on scene** (purple) |
| `Needs checking` | The automatic reading is uncertain; please check it (see C6) |
| `Unit suggested` | A unit has already been suggested but not sent yet |

**Filters** (tick boxes above the list):

- **Waiting for a unit**: show only incidents that nobody has been sent to yet.
- **Needs checking**: show only incidents whose reading is uncertain.

You can tick both. Untick them to see everything again.

**Types of incident the platform recognises:** Flooding, Fire, Building collapse, Medical emergency,
Road blocked, Power outage, Food / water shortage, and Other.

**How "same event" reports are grouped:** if a new report is of the same type, within about 500 metres of an
active incident, and that incident received a report in the last 60 minutes, the new report is added to it.
The report count goes up and so does the priority score. Reports of type "Other" are never grouped, because
two vague messages near each other are not necessarily about the same thing.

## C4. The map

- **Circles** are incidents, coloured by severity. Bigger circles have more reports.
- **Lettered squares** are units and shelters, coloured by status (see B2).
- **Hover** over any circle or square to see its name, type and status.
- **Click a circle** to open that incident's details on the right. The map moves to it, and the selected
  circle gets a dark outline.
- **Zoom** with the **+** and **−** buttons, or with your mouse wheel. **Drag** to move around.
- **Show shelters** (tick box, top-right of the map): untick to hide shelters and see the units more clearly.
- A **dashed blue line** shows the road route of the suggested unit, or of the unit on its way.
- The **legend** at the bottom-left explains the colours and letters.

## C5. The Units overview (right column, when no incident is open)

- **Units**: four boxes counting how many units are **Available**, **On the way**, **On scene** and
  **Out of service**.
- A list for each kind of unit, e.g. **AMBULANCES (8 OF 9 FREE)**, showing each unit's code, home area and
  status.
- **Shelters**: each relief camp with how many people are there out of how many it can hold, e.g.
  `120 / 200 people`. The number turns **red** when a shelter is 90% full or more.

## C6. Opening an incident

Click an incident card, or its circle on the map. The right column shows **Incident details**, with these
sections from top to bottom. Click **Close** (top-right) to go back to the Units overview.

### Summary (top)
Severity, type, the "Needs checking" tag if any, the description, the incident number and address, when it
was first reported, how many reports, and its current status.

### Priority
For example: **Score 87 out of 100**, followed by the explanation:
*"Severity 5 gives 75 pts, incident type gives 10 pts, 1 confirming report adds 2 pts."*

How the score is built:
- **Severity:** 15 points per level (Critical = 75)
- **Type:** up to 15 points (building collapse and fire count most, then medical, then flooding...)
- **Extra reports:** 2 points for each additional report about the same event, up to 10

### Classification: checking the automatic reading
This shows **who classified the incident** and **how sure** they were:

- **Classified by the AI triage agent · 85% sure**: read by the AI
- **Classified by keyword rules (AI not used) · 50% sure**: read by simple keyword matching
- **Checked by a commander**: a person has confirmed or corrected it

Below it is a short explanation of why it was classified this way.

When the incident is marked **Needs checking**, this section has a light orange background and asks
**"Is this classification correct?"**:

- **Yes, looks right**: confirms the reading. The "Needs checking" tag disappears.
- **No, change it**: opens two drop-down lists:
  1. **Type**: choose the correct kind of incident.
  2. **Severity**: choose from 5 – Critical down to 1 – Minor.
  3. Click **Save** (or **Cancel** to leave it unchanged).

  The priority score is recalculated immediately and the list re-sorts.

Even when an incident does not need checking, you can click **Change** to correct it.
Once a commander has checked an incident, new reports about the same event will not overwrite the
commander's choice.

### Response: sending help

This section changes depending on the incident's stage.

**Stage 1: nobody sent yet ("Waiting for a unit")**

1. Click **Find the best unit**. The button says "Finding the best unit..." for a moment.
2. The platform looks for the nearest free units of the right kind, checks their equipment, asks a road
   routing service for real travel times, and picks the best one. You will see:
   - **Suggested by the dispatch agent**: the unit's code and name
   - the travel time and distance by road, e.g. **9 min by road · 6.5 km**
     (if it says *(estimate)*, the road service could not be reached and the time is a rough guess)
   - a plain-language reason, for example: *"BOAT-02 recommended: 9 min by road (6.5 km), 2 min faster
     than BOAT-03. Carries water rescue boat."*
   - the route as a dashed blue line on the map
3. Optional: click **Other units considered** to see the other units it compared, with their travel times
   and any equipment they lack.
4. Decide:
   - **Send BOAT-02** (the button shows the suggested unit's code): sends the suggested unit.
   - **Choose another unit**: send a different unit (see below).
   - **Ask for a fresh suggestion**: asks again, for example if a closer unit has just become free.

Which kind of unit is suggested for each incident type:

| Incident | Unit suggested | Preferred equipment |
|---|---|---|
| Medical emergency | Ambulance | Advanced life support (for Severe and Critical) |
| Fire | Response team | Fire-fighting |
| Flooding | Response team | Water rescue boat |
| Building collapse | Response team | Search & rescue |
| Road blocked | Response team | Heavy equipment |
| Power outage | Response team | Electrical repair |
| Food / water shortage | Supply truck | Food & water |
| Other | Response team or ambulance | — |

If nothing suitable is free, you will see *"No suitable unit is available right now. Try again when a unit
is free."* The incident stays in the queue.

**Choosing a different unit (override)**

1. Click **Choose another unit**.
2. A list appears: first the units the platform compared (with travel times; the suggested one is marked
   "suggested" and cannot be picked here), then **Other available units**.
3. Click the circle next to the unit you want. Its route appears on the map.
4. Optionally type a **Reason**, e.g. "crew already knows the area". It is saved in the History.
5. Click **Send selected unit** (or **Cancel** to go back to the suggestion).

**Closing an incident that needs no unit**

For false alarms or messages that need no action (e.g. "Chennai rains are something else today!"):

1. At the bottom of the Response section, click **Close this incident** (next to "No unit needed?").
2. Confirm in the pop-up window.

The incident leaves the active list, and the History records that it was closed without sending a unit.

**Stage 2: unit on the way**

You will see, for example, **"BOAT-02 is on the way."** and below it who sent it and when, and whether it
was the suggested unit or an override (with the reason).

- When the unit reports by radio that it has arrived, click **Mark as arrived**. The unit turns purple and
  moves to the incident's location on the map.

**Stage 3: unit on scene**

- When the work is finished, click **Mark as resolved** and confirm.
  The incident leaves the active list and the unit becomes **Available** (green) again, ready for the next
  job, from its new location.

(You can also click **Mark as resolved** directly while the unit is still on the way, if the incident is
over.)

### Reports
Every report that belongs to this incident: the full text, where it came from (**Phone / walk-in** or
**Social media**), who reported it, and the time.

### History
A timeline of everything that happened to this incident, oldest first:

- **blue dots**: decisions by the computer (Triage Agent, Dispatch Agent)
- **green dots**: actions by people (with the person's name)

For example: report classified, incident created, second report merged (and how far away it was), unit
suggested with the reason, commander sent the unit, unit arrived, incident resolved. Nothing can be
deleted from this record.

## C7. Logging a report (for example, a phone call)

Click **Log a report** in the top bar.

**Left box:**

1. **What happened?** Type what the caller says. Include who is affected, how many people, and anything
   dangerous. It must be at least 10 characters long.
2. **Reported by (optional):** the caller's name or phone number.
3. **Location:** shows the chosen place once you pick it (next step).

**Right box: choose where it happened (two ways):**

- **Search:** type a street, area or landmark in **Find a place** (at least 3 letters), then click
  **Search** or press Enter. Click the right result in the list. The map moves there and drops a pin.
- **Click on the map:** click the exact spot. A pin appears and the address is looked up automatically.
  Click somewhere else to move the pin.

Then click **Save report**. The button says "Saving and classifying..." for a moment.

**The result screen** tells you:
- either **"A new incident #19 was created"**, or that the report **looks like the same event as an
  existing incident** and was added to it (with the new report count)
- the **Type**, **Severity**, **Priority score** and **who classified it** (AI or keyword rules) and how sure
- whether it was **marked for checking** on the dashboard

Click **Go to dashboard** to handle it, or **Log another report** to start a new, empty form.

If you forget the location, you will see *"Please choose where it happened: search for a place or click on
the map."*

## C8. A typical shift, start to finish

1. Log in and look at the top of the incident list.
2. Open the top incident. If it says **Needs checking**, confirm or correct it.
3. Click **Find the best unit**, read the reason, then **Send** or **Choose another unit**.
4. Move to the next incident that is "Waiting for a unit" (use the filter).
5. When units report by radio, click **Mark as arrived**, then later **Mark as resolved**.
6. Close false alarms with **Close this incident**.
7. Log phone calls with **Log a report**.

---

# Part D: Guide for the Admin

The admin sees three pages: **Dashboard**, **Log a report** and **Resources**. After login, the admin starts
on **Resources**.

## D1. The Resources page

A table of every ambulance, response team, supply truck and shelter.

| Column | Meaning |
|---|---|
| **Code** | Short unique name, e.g. AMB-04 |
| **Name** | Full name, with the home area underneath |
| **Type** | Ambulance, Response team, Supply truck or Shelter |
| **Status** | Available, On the way, On scene, Out of service, or Retired. If the unit is out on a job, it also shows "Incident #12". |
| **In use** | How much of its capacity is taken, e.g. `0 / 2` (patients), `120 / 200` (people in a shelter) |
| **Equipment** | What the unit carries, e.g. Advanced life support, Trauma kit |

**Finding a resource** (above the table):

- **Search box:** type a code, name or area (e.g. "AMB", "Velachery").
- **All types:** show only one kind (e.g. only ambulances).
- **All statuses:** show only one status (e.g. only out of service).
- **Show retired:** tick to also show resources that have been retired (shown in grey).

The table updates by itself when a unit's status changes elsewhere, for example when a commander sends it.

## D2. Adding a new resource

1. Click **Add resource** (top-right). A form opens on the right side of the screen.
2. Fill in:
   - **Code:** a short unique name, e.g. `AMB-10` (small letters become capitals automatically).
   - **Type:** Ambulance, Response team, Supply truck or Shelter.
   - **Name:** e.g. "Ambulance 10".
   - **Home base / area:** where it is stationed, e.g. "Egmore".
   - **Status:** usually **Available**. Choose **Out of service** if it is under repair.
   - **Capacity:** the hint below tells you what it means for the chosen type: patients for an ambulance,
     people in the team, relief kits for a truck, people for a shelter.
   - **Currently in use:** how much of that capacity is already taken (0 for an empty vehicle). It cannot
     be more than the capacity.
   - **Equipment / capabilities:** tick everything it carries (not shown for shelters). This matters: the
     platform prefers units with the right equipment when suggesting what to send.
   - **Location:** click on the small map where the resource is. A pin appears.
3. Click **Add resource**. The form closes and the new resource appears in the table, on every commander's
   map and in their Units overview, instantly.

Click **Cancel** to close the form without saving. (Clicking outside the form does not close it, so you
cannot lose your typing by accident.)

## D3. Editing a resource

1. Click **Edit** on the resource's row.
2. Change anything and click **Save changes**.

You **cannot change the status** of a unit that is out on a job. The status box is locked and says
"Locked while assigned to incident #12". The commander must resolve that incident first. This stops the
dashboard from showing a busy unit as free.

## D4. Retiring and bringing back a resource

- **Retire:** for a vehicle that is sold, scrapped or permanently unavailable. Click **Retire** and confirm.
  The resource becomes "Retired", disappears from the commanders' map and lists, and is never suggested for
  dispatch again. Its past history is kept. A unit that is out on a job cannot be retired until its incident
  is resolved.
- **Bring back:** tick **Show retired**, find the resource and click **Bring back**. It returns as
  **Available**.

## D5. What else the admin can do

- **Dashboard:** the admin sees exactly what the commander sees (incidents, map, suggestions, routes,
  history), updated live, but **cannot** send units, confirm classifications or close incidents. Those
  buttons are not shown.
- **Social media feed:** the admin can start, pause and reset the demo feed.
- **Log a report:** works exactly as described in C7.

---

# Part E: Guide for the Field Responder

The field responder sees one page: **My unit**. It is designed to work on a mobile phone.

## E1. The My unit page

- A greeting with your first name.
- **Your unit:** its code and name (e.g. **AMB-01** Ambulance 1) and its type.
- Its current **status** (Available, On the way, On scene, Out of service), with the coloured dot.
- One of these messages:
  - **"No task assigned at the moment."**
  - **"Your unit has been sent to incident #12. Follow the control room's instructions."**
- **Refresh:** click to load the latest status after the control room has sent your unit.

If you see *"You are not linked to a unit yet. Please contact the administrator."*, your account has not been
connected to a vehicle or team.

For privacy, a responder can only see their own unit.

## E2. Coming in the next version

The current responder page is basic. The next version will add: the incident's full details, the road route
on a map, and large buttons to report **"On my way"**, **"Arrived"** and **"Resolved"** directly from the
phone. Until then, the commander updates these stages from the dashboard after hearing from the crew by
radio or phone.

---

# Part F: Common messages and what to do

## Messages inside the platform

| Message | What it means | What to do |
|---|---|---|
| Incorrect email or password. | The login details are wrong. | Check for typing mistakes and capital letters. |
| Your session has expired. Please log in again. | You were logged in for more than 12 hours. | Log in again. |
| You do not have permission to do this. | Your role is not allowed to do that action. | Ask a commander or admin. |
| No suitable unit is available right now. Try again when a unit is free. | Every suitable unit is busy or out of service. | Resolve finished incidents to free units, then try again. |
| (unit) is no longer available. Ask the agent for a new recommendation. | Someone sent that unit somewhere else in the meantime. | Click **Ask for a fresh suggestion**. |
| This recommendation was already answered or replaced. Please refresh it. | Another commander already acted on it. | Look at the updated panel; ask for a fresh suggestion if needed. |
| A unit has already been dispatched to this incident. | Someone already sent a unit. | No action needed. |
| That is the recommended unit. Use "Send" to accept the recommendation. | You chose the suggested unit under "Choose another unit". | Cancel and click **Send** instead. |
| A shelter cannot be dispatched. Please choose a unit. | Shelters stay where they are. | Choose a vehicle or team. |
| This incident is already resolved. | It was closed already. | No action needed. |
| (unit) is assigned to incident #12. Resolve that incident first, then change the status. | You tried to change the status of a unit that is out on a job. | Ask the commander to resolve that incident first. |
| (unit) is on an active incident and cannot be retired right now. | Same as above, when retiring. | Wait until its incident is resolved. |
| Another resource already uses the code "AMB-10". | Codes must be unique. | Choose a different code. |
| ...Current load cannot be more than capacity | "Currently in use" is larger than "Capacity". | Correct the numbers. |
| Please click on the map to set the location. | The resource has no location. | Click on the small map in the form. |
| Please choose where it happened: search for a place or click on the map. | The report has no location. | Search or click on the map. |
| Address lookup is not available right now. Please pick the spot on the map. | The address search service could not be reached. | Click directly on the map instead. |
| Cannot reach the server. Check your connection and try again. | The platform's server is not running, or the connection dropped. | Check that `npm run dev` is still running (Part A7). |

## Problems when setting up or starting

| Problem | What to do |
|---|---|
| `npm` is not recognised | Node.js is not installed, or the Command Prompt was opened before installing it. Install Node.js (A2) and open a new Command Prompt. |
| `Cannot connect to the database` | PostgreSQL is not running, or the password in `server/.env` is wrong. Check `DATABASE_URL` (A5). |
| `database "drrc" does not exist` | Create the database (A4). |
| `Migration 001_init.sql failed` mentioning postgis | PostGIS is not installed for PostgreSQL 17. Install it (A2, step 4) and run `npm run db:reset` again. |
| `Invalid configuration in .env` | A line in `server/.env` is missing or wrong. The message names the line, e.g. `JWT_SECRET` must be at least 16 characters. |
| Port 4000 or 5173 already in use | The platform is already running in another window, or another program uses that port. Close the other window and try again. |
| The map is grey | No internet connection. The map pictures come from OpenStreetMap online. |
| Travel times say "(estimate)" | The free road routing service could not be reached. The platform keeps working with rough estimates. |
| `npm run ai:check` says FAILED: "API key not valid" | The key was copied wrongly. Copy it again, with no spaces. |
| ... FAILED: "permission" or "restricted" | Restrict the key to the Gemini API in AI Studio (A8, step 3). |
| ... FAILED: "quota" or "429" | You have reached the free limit. Wait and try again later. |
| ... FAILED: "model not found" | In `server/.env`, change `GEMINI_MODEL` to another model listed in Google AI Studio, e.g. `gemini-3.5-flash-lite`. |

---

# Part G: Frequently asked questions

**Does the platform ever send a unit on its own?**
No. It only suggests. A commander must click **Send** or choose another unit.

**Do I need to refresh the page?**
No. As long as the top bar says **Live**, everything updates within about a second. If it says
**Reconnecting...**, wait a moment; it catches up by itself.

**Two commanders are working at the same time. Can they send the same unit to two places?**
No. The platform checks this at the moment of sending. The second person sees a message that the unit is no
longer available.

**Why is an incident marked "Needs checking"?**
The automatic reading is not confident enough (below 60% sure), or the AI is not set up and simple keyword
matching was used. Confirm or correct it with the buttons in the Classification section.

**Why was the suggested unit not the closest one on the map?**
Because the platform uses real travel time by road, not straight-line distance. A unit that looks close may
be across a river or need a long detour. The reason text says so when this happens. It may also prefer a
unit that carries the right equipment.

**Where do resolved incidents go?**
They leave the active list. Their full record stays in the database, including the History. A page to browse
past incidents and decisions is planned for the next version.

**Can I undo "Mark as resolved"?**
No. If an incident flares up again, log a new report; it will create a new incident.

**How do I start the demo again from the beginning?**
Stop the platform (Ctrl + C), run `npm run db:reset`, then `npm run dev`. This **deletes all incidents and
changes** and reloads the original demo data.

**Is the data real?**
The map and Chennai locations are real (from OpenStreetMap). All people, phone numbers, vehicles and social
media posts are made up for the demo.

**Does it work on a phone?**
Yes. The pages rearrange themselves for small screens. The responder page is designed mainly for phones.
