# City FPS starter

Three.js browser FPS starter with the low-poly city, Tommy gun model, FPS-style triangle collision, multiplayer positions, username/password accounts, and room chat.

## Run it

1. Install Node.js LTS.
2. From this folder, run `npm install`, then `npm run dev`.
3. Open the Vite URL. The city rotates behind the sign-in panel; create an account or sign in. The page uses a black-and-white interface over the city preview.
4. To play with friends, share the same URL. A room can be selected with `?room=some-room`; everyone must use the same room value.
5. Click in the map to lock the mouse. Use WASD to move, Shift to sprint, Space to jump, and Escape to release the mouse. Chat in the panel at lower right.

## Firebase setup

The supplied Firebase web config is in `src/firebase.js`. In Firebase Console for `multiplayer-code`:

1. Enable **Authentication → Sign-in method → Email/Password**. Accounts use a reserved internal email derived from the username because Firebase Auth does not provide a username/password provider. Players enter only a username and password in the game; no email is collected or sent.
2. Create/confirm the Realtime Database at the URL in `src/firebase.js`.
3. Paste `database.rules.json` into Realtime Database → Rules and publish it. Until you publish these rules, player sync and chat will be denied.
4. For a production game, add account recovery or collect a real email, and move combat authority to a server. Username-only accounts cannot use Firebase password reset emails.

Usernames are case-insensitive for uniqueness and must be 3–16 letters, numbers, or underscores. Passwords must have at least 6 characters.

## Collision and map notes

`src/main.js` builds a Three.js `Octree` from the loaded city scene and moves a capsule-shaped player collider against the city triangles. That gives the character a body radius, prevents walking through building surfaces, slides movement along walls, supports jumping and gravity, and limits falling beyond the map bounds. A downward ray search chooses a mostly level surface for the initial spawn. Collision is based on the supplied render mesh; hidden interior walls or invisible gameplay boundaries would need separate collision geometry if the asset does not contain them.

## Project wiring

- `assets/city/scene.gltf` uses the neighboring `scene.bin` and `textures/` assets.
- `assets/weapons/tommy_gun.glb` is parented to the first-person camera.
- `src/auth.js` creates/signs in Firebase password accounts and atomically claims usernames.
- `src/network.js` syncs room positions and chat over Realtime Database.
- `src/firebase.js` initializes the supplied Firebase project.
- `database.rules.json` restricts each player to their own position record and validates chat messages.

This is still a multiplayer movement/chat starter, not a finished shooter: weapon firing, health, teams, and authoritative hit/damage logic are not included.

## City asset credit

This work is based on "Low Poly city" (https://sketchfab.com/3d-models/low-poly-city-23e03868654d47f69fa5db2413e580c3) by golukumar (https://sketchfab.com/mortalityrexotable) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

The FBX files in `assets/animations/` are Mixamo motion clips. They use the `mixamorig` skeleton naming convention and are likely compatible with a character rigged to the same Mixamo skeleton. `walking.fbx` is the regular locomotion clip; `backwards_rifle_run.fbx` is a backward rifle run; `walking_to_dying.fbx` is a death transition rather than an idle. The project still needs the rigged character model and a standing/idle clip before the animation state machine can be connected.
