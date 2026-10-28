# Gaurav ke liye Antigravity setup

Is guide ka goal hai ki tumhara Antigravity bhi Claude Code jaisa kaam kare: pehle plan banaye,
APIs docs se verify kare, chhote changes kare, tests chalaye, aur risky kaam se pehle pooche.
Saare project rules [AGENTS.md](AGENTS.md) mein hain. Wahi file Claude Code bhi padhta hai, isliye
dono agents ek hi tareeke se code likhenge.

> Antigravity ke settings ke naam aur MCP config file ki location versions ke saath badal sakti
> hai. Agar koi option yahan likhe naam se na mile, to Antigravity ke docs
> (https://antigravity.google/docs) mein check karo.

---

## Step 1: Project kholo aur check karo ki AGENTS.md load ho raha hai

1. Antigravity mein project ka root folder kholo (jahan `AGENTS.md` hai).
2. Antigravity root ki `AGENTS.md` file khud padhta hai, koi setting nahi chahiye.
3. Check karne ke liye agent se poocho:
   > "AGENTS.md ke main rules short mein batao."

   Agar wo Phase 1 scope, "extension mein API key nahi", aur "segment ID citation" jaise rules
   bata de, to file load ho rahi hai.

**AGENTS.md mein kuch badalna ho to** dono milke decide karo aur commit karo. Apni personal
preferences Step 3 wali global file mein rakho, AGENTS.md mein nahi.

---

## Step 2: Model aur agent settings

**Model:**
- Architecture, debugging aur bade changes ke liye model picker ka **sabse strong model** lo.
- Agar picker mein Claude model available ho, to complex kaam ke liye wo bhi try kar sakte ho.
  Code review ke liye alag model use karna faydemand hai.
- Chhote, simple edits ke liye fast model theek hai.

**Agent settings** (Settings → Agent; naam thoda alag ho sakta hai):
| Setting | Kya rakhna hai | Kyun |
|---|---|---|
| Review policy | **Request review** / agent pehle plan dikhaye | Bina dekhe bade changes na ho |
| Terminal command execution | **Auto-run off** (har command ke liye poochhe) | Agent khud se delete/push na kar de |
| Browser / external actions | Poochh kar | Safety |

Shuruaat mein strict rakho. Bharosa banne ke baad chhote, safe commands ko allow kar sakte ho.

---

## Step 3: Global personal rules (`~/.gemini/GEMINI.md`)

Ye tumhare saare projects par lagta hai. Isme ye daal do taaki agent ka kaam karne ka tareeka
Claude Code jaisa ho:

```markdown
# Personal rules

- Reply in Hinglish (Roman script). Code, comments and commits in English.
- Before any non-trivial change: read the relevant files, then give a short plan with the
  files you will touch. Wait for my OK on large or architectural changes.
- Make small, focused changes. Do not refactor unrelated code.
- Before writing code that uses an external API or library, check current docs (Context7 MCP
  or official docs). Never guess parameters or message formats.
- After changes, run typecheck, lint and tests, and report the real results, including failures.
- Never say something works unless you verified it.
- Ask before: deleting files, git push or force operations, adding dependencies, changing
  schemas, calling paid APIs.
- Never put API keys or secrets in code, logs, or commits.
```

---

## Step 4: MCP servers (sirf ye do abhi)

Antigravity mein MCP servers `mcp_config.json` se add hote hain (MCP settings → raw config).
Zyada MCP servers mat lagana. Har server agent ke context mein tools badhata hai, aur zyada tools
se agent ka focus bigadta hai.

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

| Server | Kaam |
|---|---|
| **Context7** | Libraries ke latest docs. Chrome MV3, Deepgram, Gemini jaisi APIs tezi se badalti hain, isse agent purana ya galat code nahi likhega. Agent ko bolo: "use context7" |
| **Chrome DevTools MCP** | Agent browser ka console, network aur errors dekh sakta hai. Extension debug karne mein kaam aayega |

**Baad mein (jab GitHub repo ban jaaye):** GitHub ka official MCP server, PRs aur issues ke liye.

**Security:**
- Sirf official ya trusted MCP servers install karo.
- `mcp_config.json` mein API keys ho to wo file kabhi commit mat karna.
- Node.js (`npx` ke liye) installed hona chahiye.

---

## Step 5: Editor extensions

Antigravity VS Code ka extension ecosystem use karta hai. Extensions panel mein naam ya ID se
search karo.

### Zaroori
| Extension | ID | Kyun |
|---|---|---|
| ESLint | `dbaeumer.vscode-eslint` | Code ki galtiyan pakadta hai |
| Prettier | `esbenp.prettier-vscode` | Dono ki formatting ek jaisi |
| EditorConfig | `EditorConfig.EditorConfig` | Tabs/spaces, line endings same |
| Vitest | `vitest.explorer` | Tests chalana aur dekhna |
| Error Lens | `usernamehw.errorlens` | Errors line par hi dikhte hain, agent aur tum dono jaldi pakadte ho |
| GitLens | `eamodio.gitlens` | Kisne kya badla, history |

### Kaam ke (optional)
| Extension | ID | Kyun |
|---|---|---|
| DotENV | `mikestead.dotenv` | `.env` files ka syntax |
| REST Client | `humao.rest-client` | Backend API ko `.http` file se test karna |
| Python + Ruff | `ms-python.python`, `charliermarsh.ruff` | Sirf agar backend Python mein bana |

Agar koi extension ID se na mile, to naam se search karo. Antigravity ka marketplace VS Code wale
se alag ho sakta hai.

**Formatting automatic karo:** Settings mein "Format on Save" on karo aur default formatter
Prettier rakho.

---

## Step 6: Roz ka workflow

1. `main` se nayi branch banao (`feature/<kaam-ka-naam>`).
2. Agent ko kaam do aur **pehle plan maango**: "Pehle plan do, code mat likho."
3. Plan padho. AGENTS.md ke architecture rules follow ho rahe hain ya nahi, check karo.
4. Approve karo, agent implement kare.
5. Agent se typecheck, lint aur tests chalwao, aur result khud dekho.
6. Pull request kholo. **Doosra developer Claude Code se review karega**, aur tum unke PR ka review
   Antigravity se karoge. Alag models alag galtiyan pakadte hain.
7. Koi architecture decision liya to `docs/` mein note karo aur AGENTS.md ka decisions log update
   karo.

**Kaam baanto taaki conflicts kam hon:** jaise ek extension (capture) par aur doosra backend
(STT/summary) par. Ek hi file par dono saath kaam na karein.

---

## Step 7: Kya kabhi nahi karna

- Extension ke code mein API key daalna.
- Free Gemini key par asli meetings ka audio bhejna. Free tier ka data Google training ke liye
  use kar sakta hai.
- Asli meetings ki recordings ya transcripts git mein commit karna.
- Agent ko bina review ke `git push` ya files delete karne dena.

---

## Jab code shuru hoga, repo mein ye files aayengi

Inse dono machines ki settings automatically same ho jaayengi:
- `.editorconfig`
- ESLint aur Prettier config
- `tsconfig.json` (`strict: true`)
- `.vscode/extensions.json` (Step 5 ke extensions as recommendations)
- `.gitignore` (`.env`, recordings, `node_modules`)
