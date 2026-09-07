#define TOTAL_NODES 34

// ── Faculty Controlled Hardware Unlock (relay) — FAIL-SAFE ────
// Digital Pin 4 drives an optocoupler -> relay -> transformer AC supply.
// This does not touch nodePins, scan(), or any existing wiring logic.
//
// Fail-safe contract:
//   - Relay has exactly two states: RELAY_LOCKED / RELAY_UNLOCKED.
//   - Boots LOCKED. Any reset/restart returns to LOCKED.
//   - UNLOCK   -> relay ON,  only if not already UNLOCKED (no redundant writes).
//   - LOCK     -> relay OFF, only if not already LOCKED (no redundant writes).
//   - HEARTBEAT -> refreshes the timeout timer only; never toggles the relay.
//   - If more than RELAY_TIMEOUT_MS elapses since the last UNLOCK/HEARTBEAT
//     while UNLOCKED, the relay is force-LOCKED with no backend command
//     required. This is what guarantees the relay can never stay energized
//     because of stale/lost communication (backend crash, disconnect, etc).
#define RELAY_PIN 4
#define RELAY_LOCKED 0
#define RELAY_UNLOCKED 1
#define RELAY_TIMEOUT_MS 3000UL

String serialCmdBuffer = "";
int relayState = RELAY_LOCKED;
unsigned long lastHeartbeat = 0;

// NOTE: deliberately no Serial.print() debug output in these relay
// functions. Serial is shared with the JSON scan stream consumed by the
// frontend/backend parser (printConnections/printGroups below) — writing
// extra lines here would corrupt that stream, which we must not touch.
// All relay logging happens on the backend side (hardware_relay.py),
// which knows the state transitions it initiated.
// This is a PC817 opto-isolated relay module (active-LOW): IN=LOW energizes
// the relay, IN=HIGH de-energizes it. So the physical drive level is the
// OPPOSITE of the logical state — invert on every write here.
void setRelayLocked()
{
  if (relayState != RELAY_LOCKED) {
    digitalWrite(RELAY_PIN, LOW);  // HIGH = de-energized = OFF on this module
    relayState = RELAY_LOCKED;
  }
}

void setRelayUnlocked()
{
  if (relayState != RELAY_UNLOCKED) {
    digitalWrite(RELAY_PIN, HIGH);   // LOW = energized = ON on this module
    relayState = RELAY_UNLOCKED;
  }
}

void handleRelaySerial()
{
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      serialCmdBuffer.trim();
      if (serialCmdBuffer == "UNLOCK") {
        lastHeartbeat = millis();
        setRelayUnlocked();
      } else if (serialCmdBuffer == "HEARTBEAT") {
        // Refresh timer only. Do not toggle relay state either way —
        // if we're already LOCKED (e.g. a HEARTBEAT arrived just after
        // a timeout fired), a stray HEARTBEAT must not re-energize it.
        if (relayState == RELAY_UNLOCKED) {
          lastHeartbeat = millis();
        }
      } else if (serialCmdBuffer == "LOCK") {
        setRelayLocked();
      }
      serialCmdBuffer = "";
    } else if (serialCmdBuffer.length() < 32) {
      // Bounded buffer: ignore/reset on garbage input rather than growing
      // unbounded, so corrupted serial noise can never wedge this parser.
      serialCmdBuffer += c;
    } else {
      serialCmdBuffer = "";
    }
  }
}

void checkRelayTimeout()
{
  // Fail-safe core: no backend command is required for this to fire.
  // If we're UNLOCKED and haven't heard UNLOCK/HEARTBEAT within the
  // timeout window, force the relay OFF immediately.
  if (relayState == RELAY_UNLOCKED && (millis() - lastHeartbeat > RELAY_TIMEOUT_MS)) {
    setRelayLocked();
  }
}

int nodePins[TOTAL_NODES] = {
  22,23,24,25,26,27,28,29,30,31,
  32,33,34,35,36,37,38,39,40,41,
  42,43,44,45,46,47,48,49,50,51,
  52,53,2,3
};

// ── Union-Find ────────────────────────────────
int ufParent[TOTAL_NODES];

int ufFind(int x) {
  while (ufParent[x] != x) {
    ufParent[x] = ufParent[ufParent[x]];
    x = ufParent[x];
  }
  return x;
}

void ufUnion(int a, int b) {
  a = ufFind(a); b = ufFind(b);
  if (a != b) ufParent[a] = b;
}

// ── Confirmation ──────────────────────────────
#define CONFIRM_COUNT 3
bool rawAdj[TOTAL_NODES][TOTAL_NODES];
bool confirmedAdj[TOTAL_NODES][TOTAL_NODES];
bool prevConfirmed[TOTAL_NODES][TOTAL_NODES];
int  confirmMatrix[TOTAL_NODES][TOTAL_NODES];

// ── Order tracking ────────────────────────────
int firstSeenOrder[TOTAL_NODES];
int orderCounter = 1;


// ── Chain reorder logic (NEW) ─────────────────
void reorderChain(int *members, int count)
{
  if (count < 2) return;

  int ordered[TOTAL_NODES];
  bool used[TOTAL_NODES];
  memset(used,false,sizeof(used));

  int start = -1;

  for(int i=0;i<count;i++)
  {
    int deg = 0;

    for(int j=0;j<count;j++)
    {
      if(confirmedAdj[members[i]][members[j]])
        deg++;
    }

    if(deg == 1)
    {
      start = i;
      break;
    }
  }

  if(start == -1) return;

  ordered[0] = members[start];
  used[start] = true;

  for(int k=1;k<count;k++)
  {
    int prev = ordered[k-1];

    for(int j=0;j<count;j++)
    {
      if(!used[j] && confirmedAdj[prev][members[j]])
      {
        ordered[k] = members[j];
        used[j] = true;
        break;
      }
    }
  }

  for(int i=0;i<count;i++)
    members[i] = ordered[i];
}


// ── Scan ──────────────────────────────────────
void scan()
{
  memset(rawAdj, false, sizeof(rawAdj));

  for (int i = 0; i < TOTAL_NODES; i++)
  {
    for (int k = 0; k < TOTAL_NODES; k++)
      pinMode(nodePins[k], INPUT_PULLUP);
    delayMicroseconds(300);

    pinMode(nodePins[i], OUTPUT);
    digitalWrite(nodePins[i], LOW);
    delayMicroseconds(300);

    for (int j = i + 1; j < TOTAL_NODES; j++)
    {
      bool r1 = (digitalRead(nodePins[j]) == LOW);
      delayMicroseconds(200);
      bool r2 = (digitalRead(nodePins[j]) == LOW);
      if (r1 && r2) {
        rawAdj[i][j] = true;
        rawAdj[j][i] = true;
      }
    }
    pinMode(nodePins[i], INPUT_PULLUP);
  }

  // Pass 1: update confirmation counters
  for (int i = 0; i < TOTAL_NODES; i++)
    for (int j = i + 1; j < TOTAL_NODES; j++)
    {
      if (rawAdj[i][j]) {
        if (confirmMatrix[i][j] < CONFIRM_COUNT)
          confirmMatrix[i][j]++;
        if (confirmMatrix[i][j] >= CONFIRM_COUNT) {
          confirmedAdj[i][j] = true;
          confirmedAdj[j][i] = true;
        }
      } else {
        confirmMatrix[i][j] = 0;
        confirmedAdj[i][j]  = false;
        confirmedAdj[j][i]  = false;
      }
    }

  // Pass 2: assign order ONLY to newly confirmed nodes
  for (int i = 0; i < TOTAL_NODES; i++)
    for (int j = i + 1; j < TOTAL_NODES; j++)
    {
      bool justConfirmed = confirmedAdj[i][j] && !prevConfirmed[i][j];
      if (justConfirmed) {
        if (firstSeenOrder[i] == 0) firstSeenOrder[i] = orderCounter++;
        if (firstSeenOrder[j] == 0) firstSeenOrder[j] = orderCounter++;
      }
      prevConfirmed[i][j] = confirmedAdj[i][j];
      prevConfirmed[j][i] = confirmedAdj[j][i];
    }

  // Pass 3: clear order for fully disconnected nodes
  for (int i = 0; i < TOTAL_NODES; i++) {
    bool hasAny = false;
    for (int j = 0; j < TOTAL_NODES; j++)
      if (confirmedAdj[i][j]) { hasAny = true; break; }
    if (!hasAny) firstSeenOrder[i] = 0;
  }
}


// ── Print Connections (NEW) ────────────────────
// Emits only the REAL jumper wires, not every electrically
// confirmed pair. A chain like 11-12-26 reads 11↔12, 12↔26,
// AND 11↔26 as "confirmed" (they're all the same net), but
// only 11-12 and 12-26 were physically plugged. So instead of
// dumping confirmedAdj directly, we build a minimum spanning
// tree per group using a temporary Union-Find: an edge is only
// printed if it JOINS two previously separate components.
// Edges are then sorted by firstSeenOrder so the list comes out
// in the order the jumpers were actually plugged in — same
// ordering style as printGroups()/reorderChain() below.
// Opens the JSON object; printGroups() below closes it.
void printConnections()
{
  Serial.print("{\"connections\":[");

  int tempParent[TOTAL_NODES];
  for (int i = 0; i < TOTAL_NODES; i++) tempParent[i] = i;

  int edgeA[TOTAL_NODES], edgeB[TOTAL_NODES];
  int edgeCount = 0;

  for (int i = 0; i < TOTAL_NODES; i++) {
    for (int j = i + 1; j < TOTAL_NODES; j++) {
      if (!confirmedAdj[i][j]) continue;

      int ri = i, rj = j;
      while (tempParent[ri] != ri) ri = tempParent[ri];
      while (tempParent[rj] != rj) rj = tempParent[rj];

      if (ri != rj) {
        // joins two separate components -> a real spanning edge
        tempParent[ri] = rj;
        edgeA[edgeCount] = i;
        edgeB[edgeCount] = j;
        edgeCount++;
      }
      // else: i and j already reachable via another path ->
      // redundant/derived edge (like 11-26), skip it
    }
  }

  // sort edges by plug-in order (earlier firstSeenOrder of the pair first)
  for (int a = 0; a < edgeCount - 1; a++) {
    for (int b = a + 1; b < edgeCount; b++) {
      int oaA = firstSeenOrder[edgeA[a]] == 0 ? 99999 : firstSeenOrder[edgeA[a]];
      int oaB = firstSeenOrder[edgeB[a]] == 0 ? 99999 : firstSeenOrder[edgeB[a]];
      int oa  = (oaA < oaB) ? oaA : oaB;

      int obA = firstSeenOrder[edgeA[b]] == 0 ? 99999 : firstSeenOrder[edgeA[b]];
      int obB = firstSeenOrder[edgeB[b]] == 0 ? 99999 : firstSeenOrder[edgeB[b]];
      int ob  = (obA < obB) ? obA : obB;

      if (oa > ob) {
        int ta = edgeA[a]; edgeA[a] = edgeA[b]; edgeA[b] = ta;
        int tb = edgeB[a]; edgeB[a] = edgeB[b]; edgeB[b] = tb;
      }
    }
  }

  bool first = true;
  for (int k = 0; k < edgeCount; k++) {
    if (!first) Serial.print(",");
    first = false;

    Serial.print("[");
    Serial.print(edgeA[k] + 1);
    Serial.print(",");
    Serial.print(edgeB[k] + 1);
    Serial.print("]");
  }

  Serial.print("],");
}


// ── Print Groups ──────────────────────────────
void printGroups()
{
  for (int i = 0; i < TOTAL_NODES; i++) ufParent[i] = i;

  for (int i = 0; i < TOTAL_NODES; i++)
    for (int j = i + 1; j < TOTAL_NODES; j++)
      if (confirmedAdj[i][j])
        ufUnion(i, j);

  Serial.print("\"groups\":[");
  bool firstGroup = true;

  for (int root = 0; root < TOTAL_NODES; root++)
  {
    if (ufFind(root) != root) continue;

    int members[TOTAL_NODES];
    int count = 0;

    for (int i = 0; i < TOTAL_NODES; i++)
      if (ufFind(i) == root)
        members[count++] = i;

    if (count < 2) continue;

    // reorder chain (NEW LINE)
    reorderChain(members, count);

    // Sort by firstSeenOrder
    for (int a = 0; a < count - 1; a++)
      for (int b = a + 1; b < count; b++)
      {
        int oa = firstSeenOrder[members[a]];
        int ob = firstSeenOrder[members[b]];
        if (oa == 0) oa = 99999;
        if (ob == 0) ob = 99999;

        if (oa > ob) {
          int tmp = members[a];
          members[a] = members[b];
          members[b] = tmp;
        }
      }

    if (!firstGroup) Serial.print(",");
    firstGroup = false;

    Serial.print("[");
    for (int k = 0; k < count; k++) {
      if (k > 0) Serial.print(",");
      Serial.print(members[k] + 1);
    }
    Serial.print("]");
  }

  Serial.println("]}");
}


// ── Setup ─────────────────────────────────────
void setup()
{
  Serial.begin(115200);
  memset(confirmMatrix,  0,     sizeof(confirmMatrix));
  memset(confirmedAdj,   false, sizeof(confirmedAdj));
  memset(prevConfirmed,  false, sizeof(prevConfirmed));
  memset(firstSeenOrder, 0,     sizeof(firstSeenOrder));
  orderCounter = 1;

  // Fail-safe: relay always boots LOCKED. On this active-LOW module, HIGH
  // = de-energized = OFF. Only an explicit UNLOCK command received after
  // this point can energize it, and even then it will auto-LOCK again if
  // HEARTBEATs stop arriving (see loop()).
  digitalWrite(RELAY_PIN, HIGH);  // set level BEFORE declaring OUTPUT, so
  pinMode(RELAY_PIN, OUTPUT);     // there's no glitch-LOW window on boot
  relayState = RELAY_LOCKED;
  lastHeartbeat = millis();
}


// ── Loop ──────────────────────────────────────
void loop()
{
  handleRelaySerial();
  checkRelayTimeout();
  scan();
  printConnections();
  printGroups();
}
