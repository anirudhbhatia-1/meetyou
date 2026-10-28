# AI Meeting Recorders & Summarizers: Complete Technical Blueprint & Market Architecture

This master document details the architecture, feature set, DSP audio pipeline, speech-to-text (STT) streaming, video fragment storage, LLM summarization strategies, Granola "anchor" mechanics, conversation analytics, and Model Context Protocol (MCP) integrations across modern AI meeting recorders.

---

## 1. Complete Feature Matrix & Market Taxonomy

AI meeting recorders fall into six architectural paradigms across the modern software landscape:

1. **Bot-Free Native Desktop Clients** (*Granola, Scribbl, Bluedot, Jamie*)
2. **Cloud Container Headless Bots** (*Fireflies.ai, Otter.ai, Fathom, tl;dv*)
3. **Always-On Local Screen/Audio Recorders** (*Screenpipe*)
4. **Hardware Wearables & Hardware Recorders** (*Plaud Note, Limitless*)
5. **Headless Infrastructure Platforms** (*Recall.ai*)
6. **Enterprise Sales Intelligence Platforms** (*Gong, Chorus.ai*)

### Market Feature Taxonomy Table

| Feature Name | Primary Purpose & UX | Exemplar Platforms | Technical Implementation Blueprint | Tech Stack / Protocols |
| :--- | :--- | :--- | :--- | :--- |
| **Bot-Free System Audio Capture** | Captures clean system audio without joining a virtual bot participant into the call. | Granola, Scribbl, Bluedot, Screenpipe | Hooks directly into OS audio render output buffers via native desktop APIs (`ScreenCaptureKit` or `WASAPI`). | macOS `ScreenCaptureKit`, Windows `WASAPI`, C++, Swift |
| **Cloud Headless Bot Ingestion** | Deploys an automated virtual attendee to record, stream, and interact in video meetings. | Fireflies.ai, Otter.ai, Fathom, tl;dv, Recall.ai | Spawns headless Docker containers with virtual framebuffers (`Xvfb`) driving Chromium via Playwright/Puppeteer. | Docker, Playwright, `Xvfb`, PulseAudio, AWS ECS |
| **Dual-Lane Channel Isolation** | Guarantees exact host vs. guest speaker attribution without AI guessing. | Granola, Scribbl, Native Apps | Separates physical microphone input (Channel 0) and system audio output (Channel 1) into two discrete PCM audio tracks. | CoreAudio Multichannel, Linear PCM 16kHz |
| **Acoustic Echo Cancellation (AEC)** | Prevents speaker output sound from leaking back into microphone input during open-speaker calls. | All Native Desktop Recorders | Subtracts system playback buffer signal from physical mic input buffer using adaptive NLMS algorithms. | WebRTC AEC3 Engine, C++ NLMS Filters |
| **Neural Noise Suppression** | Eliminates keyboard clicks, fan hum, background noise, and distorted vocals. | Krisp, Fireflies, Otter, Fathom | Filters 10ms audio frames through recurrent neural networks trained on vocal spectrum isolation. | RNNoise, DeepFilterNet, ONNX Runtime |
| **Dynamic Vocabulary Biasing** | Eliminates phonetic misspelling of company names, attendees, and domain jargon. | Fireflies, Granola, Otter, Deepgram | Pre-extracts event titles and attendee lists from calendar webhooks; injects weighted phrase arrays into STT decoders. | Deepgram Nova-3 API, AssemblyAI Keywords |
| **Single-Track Neural Diarization** | Identifies "who spoke when" on a single mixed audio track. | Fireflies, Otter, Fathom, Plaud | Applies Silero VAD for speech segmentation, extracts ECAPA-TDNN 192-dim vocal embeddings, and performs AHC clustering. | PyAnnote Audio, NeMo, ECAPA-TDNN |
| **Fragmented MP4 (fMP4) Streaming** | Prevents video file corruption during application crashes, system reboots, or network drops. | Fathom, tl;dv, Fireflies, Recall.ai | Continuously writes `moof` + `mdat` atom pairs every 10 seconds directly to S3 multipart upload streams. | FFmpeg (`-movflags frag_keyframe`), AWS S3 |
| **GPU-Accelerated Video Encoding** | Encodes 1080p 30FPS video while keeping host CPU usage under 4%. | Granola, Fathom, Screenpipe | Passes raw YUV420 pixel buffers directly to GPU silicon encoders (Apple VideoToolbox / NVIDIA NVENC). | `VTCompressionSession`, NVIDIA NVENC |
| **Encrypted HLS Media Delivery** | Secures video playback streams in web apps with tokenized access. | Fireflies, Otter, Fathom | Splits video chunks into HTTP Live Streaming (`.m3u8`) playlists with AES-256 key rotation. | HLS.js, AWS Elemental MediaConvert |
| **Map-Reduce Summarization** | Summarizes 2+ hour transcripts without exceeding LLM context windows or losing details. | Fireflies, Otter, Fathom, Circleback | Splits transcripts into 10-minute sliding windows, runs parallel map prompts, and combines intermediate outputs in a master reduce prompt. | Claude 3.5 Sonnet, GPT-4o, LangChain |
| **Granola "Anchor Expansion"** | Blends human shorthand notes with verified AI detail expansion. | Granola | Ingests live user notes as structural anchor headings; directs LLM to generate gray detail sub-bullets strictly bound to transcript chunks. | System Prompt Constraints, Cosine Similarity |
| **Structured JSON Schema Extraction** | Generates predictable action item lists, decisions, and CRM fields. | Circleback, Bluedot, Granola | Enforces Pydantic/JSON schema response formats on LLM outputs via function calling / structured outputs. | Instructor Library, OpenAI Structured Outputs |
| **Timestamp Citation & Cosine Audit** | Proves summary accuracy by linking sentences directly to audio timestamps. | Granola, Fathom, tl;dv | Matches generated sentence embeddings against transcript chunk embeddings using cosine similarity to attach timestamp links. | `text-embedding-3-small`, Vector Cosine Search |
| **Talk-to-Listen Ratio Analytics** | Measures airtime distribution between host and guests to evaluate meeting balance. | Gong, Chorus, Fireflies, Otter | Sums active speech utterance durations per speaker ID over total meeting runtime. | JavaScript Math Engine, Chart.js |
| **Speech Cadence & Disfluency Profiling** | Evaluates speaker confidence and communication clarity. | Gong, Otter | Calculates Words Per Minute (WPM) speed and parses filler words ("um", "ah", "like", "you know") via phonetic regex. | Regex NLP Parser, Speech Metrics |
| **Automated CRM Sync & Ticket Push** | Eliminates manual data entry for sales and product teams. | Fireflies, Fathom, Gong | Extracts opportunity updates or bug reports and pushes structured JSON to CRM REST APIs. | Salesforce API, HubSpot API, Linear API |
| **Cross-Meeting RAG Vector Memory** | Allows users to query historical meeting knowledge ("What did we decide about budget last month?"). | Fireflies Ask Fred, Otter Chat, Granola | Chunks transcripts/summaries into 512-token segments, indexes them in vector databases, and executes hybrid RAG search. | Qdrant, Pinecone, Cohere Rerank |
| **Model Context Protocol (MCP) Server** | Exposes meeting memory directly to AI assistants (Claude, Cursor, ChatGPT). | Granola, Custom Implementations | Runs a local JSON-RPC server implementing the MCP standard to expose transcript search tools to external LLM environments. | MCP SDK (TypeScript/Python), JSON-RPC |
| **PII Redaction & Compliance Masking** | Prevents sensitive personal data or payment info from hitting third-party LLM APIs. | Fireflies Enterprise, Otter Business | Runs Named Entity Recognition (NER) models to redact SSNs, credit card numbers, and passwords prior to cloud processing. | Microsoft Presidio, Regex Redaction Engine |

---

## 2. Pre-Meeting & Capture Architecture

Meeting recorders ingest audio and video via two distinct architectural pathways: **Bot-Free Native Desktop Ingestion** or **Cloud Container Headless Bots**.

```
PARADIGM A: BOT-FREE NATIVE CAPTURE (e.g., Granola)
+-------------------------------------------------------------------------+
| Local Laptop (macOS / Windows)                                          |
|                                                                         |
|  [ Local Calendar ] ---> [ Detect Meeting URL ]                        |
|                                 |                                       |
|                                 v                                       |
|  [ Physical Mic ]  ---> Channel 0 PCM Stream --+                        |
|                                                |---> [ Dual-Channel ]   |
|  [ System Audio ] ---> Channel 1 PCM Stream --+     [ Audio Pipeline ] |
|  (ScreenCaptureKit / WASAPI)                                            |
+-------------------------------------------------------------------------+

PARADIGM B: CLOUD CONTAINER BOT (e.g., Fireflies, Otter, Fathom)
+-------------------------------------------------------------------------+
| AWS ECS / Docker Infrastructure                                         |
|                                                                         |
|  [ Calendar Webhook ] ---> [ Spawn Docker Container ]                   |
|                                      |                                  |
|                                      v                                  |
|  [ Virtual Xvfb :99 ] ---> [ Playwright Headless Chromium ]             |
|                                      |                                  |
|                                      v                                  |
|  [ FFmpeg Screen + Audio Grab ] ---> [ S3 Bucket / Streaming STT ]      |
+-------------------------------------------------------------------------+
```

### 2.1 Bot-Free Native Audio/Video Ingestion Mechanics

Native apps bypass join consent screens and bot waiting rooms by leveraging OS-level loopback interfaces.

#### macOS Ingestion (`ScreenCaptureKit` + CoreAudio)
Introduced in macOS 13+, `ScreenCaptureKit` allows applications to isolate system audio without installing virtual kernel extensions (e.g., BlackHole or Soundflower).

##### Swift Implementation: `ScreenCaptureKit` System Audio Tap
```swift
import Foundation
import ScreenCaptureKit
import CoreAudio

class AudioCaptureManager: NSObject, SCStreamDataOutput {
    private var stream: SCStream?
    
    func startSystemAudioCapture() async throws {
        // Fetch available screen contents
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { return }
        
        // Exclude self application audio to prevent local feedback loops
        let filter = SCContentFilter(display: display, excludingApplications: [])
        
        // Configure stream for 16kHz Mono PCM (Optimal for Speech-to-Text)
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 16000
        config.channelCount = 1
        
        stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream?.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "audio.capture.queue"))
        try await stream?.startCapture()
    }
    
    // CoreAudio Delegate Buffer Callback
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        // Extract PCM buffer and forward to local audio processing queue / WebSockets
    }
}
```

#### Windows Ingestion (`WASAPI` Loopback)
On Windows 10/11, native capture relies on the Windows Audio Session API (`WASAPI`) initialized in `AUDCLNT_STREAMFLAGS_LOOPBACK` mode.

##### C++ Conceptual Loopback Hook
```cpp
#include <mmdeviceapi.h>
#include <Audioclient.h>

HRESULT StartWASAPILoopbackCapture(IAudioCaptureClient** ppCaptureClient) {
    IMMDeviceEnumerator* pEnumerator = NULL;
    IMMDevice* pDevice = NULL;
    IAudioClient* pAudioClient = NULL;
    WAVEFORMATEX* pwfx = NULL;

    CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, IID_PPV_ARGS(&pEnumerator));
    pEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &pDevice);
    pDevice->Activate(IID_IAudioClient, CLSCTX_ALL, NULL, (void**)&pAudioClient);
    
    pAudioClient->GetMixFormat(&pwfx);
    // Initialize stream in Loopback mode to read speaker render buffer
    pAudioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, pwfx, NULL);
    pAudioClient->GetService(IID_PPV_ARGS(ppCaptureClient));
    pAudioClient->Start();
    
    return S_OK;
}
```

### 2.2 Cloud Container Bot Ingestion Mechanics

Cloud-bot architectures operate in serverless container clusters.

#### Execution Sequence:
1. **Calendar Push Sync**: Google Workspace / Outlook Webhooks notify the server of an upcoming meeting URL (`meet.google.com/xxx-yyyy-zzz` or `zoom.us/j/123456`).
2. **Container Provisioning**: AWS ECS / Kubernetes launches an ephemeral Docker instance.
3. **Headless Browser Execution**: Playwright opens Chromium backed by `Xvfb` (X Virtual Framebuffer) and `PulseAudio` virtual sink.
4. **Meeting Join & Chat Disclaimer**: Bot types name ("Notetaker Bot"), passes waiting rooms, and sends required legal disclaimers to the in-meeting chat.
5. **Stream Extraction**: FFmpeg captures `:99.0` display buffer and PulseAudio audio monitor, encoding streams for processing.

#### Production Docker Startup Script (`entrypoint.sh`)
```bash
#!/bin/bash
# 1. Start virtual display buffer at 1080p
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

# 2. Launch PulseAudio virtual null sink
pulseaudio -D --exit-idle-time=-1
pactl load-module module-null-sink sink_name=virtual_speaker
pactl set-default-sink virtual_speaker

# 3. Launch Playwright script to join video call
node join_meeting.js --url="$MEETING_URL" --name="AI Notetaker" &

# 4. Stream captured audio and video to S3 and STT server via FFmpeg
ffmpeg -y -f x11grab -video_size 1920x1080 -framerate 30 -i :99.0 \
  -f pulse -i virtual_speaker.monitor \
  -c:v libx264 -preset ultrafast -crf 23 -g 60 \
  -movflags frag_keyframe+empty_moov+default_base_moof \
  -c:a pcm_s16le -ar 16000 -ac 1 \
  -f flv rtmp://ingest.stt-pipeline.internal/live/stream_key
```

---

## 3. Audio DSP Engine, STT Streaming & Error Mitigation

Meeting audio often suffers from room reverberation, acoustic echo, low-quality Bluetooth microphones, background noise, and overlapping speech. To handle these issues, platforms process incoming PCM audio frames through a multi-stage DSP pipeline before feeding them into STT models.

```
RAW AUDIO INGEST
   |
   v
[ Acoustic Echo Cancellation (AEC3) ] ---> Removes speaker playback leak from mic
   |
   v
[ Neural Noise Suppression (RNNoise) ] --> Removes fans, typing, dog barks
   |
   v
[ Automatic Gain Control (EBU R128) ] -> Normalizes volume to -16 LUFS
   |
   v
[ Silero Voice Activity Detection ] ----> Trims non-speech silence frames
   |
   v
[ Dual-Lane STT Streaming / Diarization ]
```

### 3.1 Audio Signal Quality Engine & DSP Pipelines

#### 1. Acoustic Echo Cancellation (AEC)
When using open speakers, sound from remote participants comes out of the host's laptop speakers and leaks back into the host's physical microphone.
- **Mechanism**: The system buffers the output render channel ($y[n]$) and uses a Normalized Least Mean Squares (NLMS) adaptive filter to subtract estimated echo ($\hat{d}[n]$) from the microphone signal ($x[n]$):
  $$e[n] = x[n] - \hat{d}[n]$$
- **Implementation**: Production engines integrate WebRTC's `AEC3` module.

#### 2. Neural Noise Suppression & Spectral Subtraction
Standard spectral gating cuts audio below a set volume threshold, which can distort quiet human voices.
- **Mechanism**: Modern recorders run recurrent neural networks (e.g., `RNNoise` or `DeepFilterNet`) on 10ms frame blocks. The GRU network estimates vocal gain coefficients per frequency band, dampening background noise while preserving formant structures.

#### 3. Automatic Gain Control (AGC) & Loudness Normalization
Volume levels fluctuate when users move relative to their microphone or alternate between whispering and shouting.
- **Mechanism**: Dynamic Compression calculates Integrated Loudness in LUFS (EBU R128 standard). It applies dynamic gain (+12dB boost for quiet whisperers, -8dB attenuation for sudden loud bursts) to keep the target audio output steady at **-16 LUFS**.

#### 4. Packet Loss Concealment (PLC)
Wi-Fi drops cause missing audio frames, leading to robotic artifacts or skipped words in transcriptions.
- **Mechanism**: Algorithms like SOLA (Synchronized Overlap-Add) perform pitch-period time-domain extrapolation to synthetically generate smooth 20ms audio bridges across dropped packets.

### 3.2 Speech-to-Text Streaming & Dynamic Vocabulary Biasing

Audio is continuously chunked into 250ms–500ms frames and streamed over WebSockets to low-latency ASR engines (e.g., Deepgram Nova-3, AssemblyAI Universal-2, or self-hosted Whisper Live).

#### Dynamic Vocabulary Biasing Implementation
To prevent misspellings of proper nouns, technical terms, or attendee names, calendar metadata is injected directly into the ASR decoder array prior to stream initialization.

```javascript
// Node.js WebSocket client stream initialization with vocabulary biasing
import WebSocket from 'ws';

const DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen";

function createStreamingSTTSession(calendarMetadata) {
    const ws = new WebSocket(`${DEEPGRAM_WS_URL}?model=nova-3&encoding=linear16&sample_rate=16000&diarize=true&punctuate=true`, {
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
    });

    ws.on('open', () => {
        // Inject Dynamic Vocabulary Boost Payload
        const initialConfig = {
            type: "Configure",
            processors: {
                keywords: [
                    `Granola:${calendarMetadata.boostWeight || 5.0}`,
                    `ScreenCaptureKit:4.0`,
                    `Kubernetes:3.5`,
                    ...calendarMetadata.attendees.map(name => `${name}:4.0`)
                ]
            }
        };
        ws.send(JSON.stringify(initialConfig));
    });

    ws.on('message', (data) => {
        const response = JSON.parse(data);
        if (response.channel && response.channel.alternatives[0]) {
            const transcriptChunk = response.channel.alternatives[0];
            console.log(`[${transcriptChunk.words[0].speaker}] ${transcriptChunk.transcript}`);
        }
    });

    return ws;
}
```

### 3.3 Neural Speaker Diarization Pipeline ("Who Spoke When")

When processing single-channel mixed audio (e.g., from cloud bots), the app runs speaker diarization to separate speech tracks.

```
[ Audio Stream ]
       |
       v
[ Silero VAD ] ---------------> Trims non-speech silence (< 0.85 probability)
       |
       v
[ Frame Chunking ] -----------> Generates 1.5s sliding windows (0.75s overlap)
       |
       v
[ ECAPA-TDNN Model ] ---------> Extracts 192-dimensional vocal vector embeddings
       |
       v
[ Agglomerative Hierarchical ] -> Clusters embeddings by Cosine Similarity
  Clustering (AHC)             -> Assigns Speaker_0, Speaker_1, Speaker_2 labels
```

---

## 4. Video Capture, Hardware Encoding & Fragmented Storage Mechanics

Video pipelines must process high-definition 1080p screen shares without overloading the host machine or corrupting files during unexpected crashes.

```
[ Screen / Camera Frames (30 FPS YUV420) ]
                   |
                   v
[ Hardware Encoder (VideoToolbox / NVENC) ]
                   |
                   v
[ Fragmented MP4 (fMP4) Writer ]  ---> Writes [moof][mdat] atom pairs every 10s
                   |
                   v
[ AWS S3 Multipart Presigned Upload ]
                   |
                   v
[ AWS Lambda + HLS Transcoder ] -------> Outputs encrypted .m3u8 master playlists
```

### 4.1 Fragmented MP4 (fMP4) Crash Resilience
Standard MP4 files store their index directory metadata in a single `moov` atom located at the end of the file. If an application crashes before closing the file, the entire video stream becomes unplayable.

Fragmented MP4 (`fMP4`) solves this by organizing video into a series of self-contained fragments, each consisting of a Movie Fragment Header (`moof`) and Media Data Atom (`mdat`). Every 10-second segment is fully readable on its own.

### 4.2 Production FFmpeg Encoding Pipeline Command

The following FFmpeg command configures a fault-tolerant fMP4 pipeline that streams video segments directly to storage buffers:

```bash
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :99.0 \
  -f pulse -i virtual_speaker.monitor \
  -c:v libx264 -preset ultrafast -crf 23 -g 60 \
  -movflags frag_keyframe+empty_moov+default_base_moof \
  -c:a aac -b:a 128k \
  -f segment -segment_time 10 -segment_format mp4 \
  -reset_timestamps 1 "s3_upload_buffer_%03d.mp4"
```

---

## 5. LLM Summarization Pipelines & Granola "Anchor" Mechanics

Raw transcripts from a 1-hour meeting contain roughly 8,000 to 12,000 words. Processing this text requires structured summarization pipelines and prompt chains.

```
                   RAW TRANSCRIPT (10,000+ Words)
                                 |
                                 v
        [ Hierarchical Map-Reduce Sliding Windows ]
        |---> Window A (0-10m)  --> Intermediate JSON Summary A
        |---> Window B (10-20m) --> Intermediate JSON Summary B
        |---> Window C (20-30m) --> Intermediate JSON Summary C
                                 |
                                 v
                    [ Master Reduce Prompt Chain ]
                                 |
                                 v
         [ Granola "Anchor-Expansion" Dual Visual Layer ]
         +-------------------------------------------------+
         | ● DECISION: Deploy ScreenCaptureKit for macOS   | (User Anchor Note)
         |   └─ Confirmed transition on macOS 13+. Cuts    | (AI Expanded Detail)
         |      CPU load from 18% to 3.2%. [t=412s]       |
         +-------------------------------------------------+
```

### 5.1 Granola "Anchor-Expansion" Mechanics
Granola pioneered the **Human-in-the-Loop Anchor Expansion** note-taking pattern:
1. **User Action**: During a meeting, the user types short bullet points (e.g., `- DECISION: Use ScreenCaptureKit`). These act as **Black Structural Anchors**.
2. **AI Processing**: Post-meeting, the LLM maps each user bullet point to the surrounding transcript context using semantic vector similarity search.
3. **Dual Visual Layer Output**: The application displays the user's handwritten bullet as a prominent heading (black text), followed by LLM-generated sub-bullets (gray text) containing detailed context, verified facts, and timestamp references.

### 5.2 Structured Pydantic JSON Schema Prompt Output
To yield consistent, machine-readable output from LLM summarizations, platforms enforce strict JSON schema outputs.

#### Python Pydantic Schema Definition
```python
from pydantic import BaseModel, Field
from typing import List, Optional

class ActionItem(BaseModel):
    task: str = Field(..., description="Actionable verb phrase describing task")
    assignee: str = Field(..., description="Name of assigned participant or 'Unassigned'")
    due_date: Optional[str] = Field(None, description="ISO8601 date string if stated, else null")
    confidence_score: float = Field(..., description="Confidence score between 0.0 and 1.0")

class KeyDecision(BaseModel):
    decision: str = Field(..., description="Summary of agreed decision")
    timestamp_seconds: int = Field(..., description="Audio start offset timestamp in seconds")
    speaker: str = Field(..., description="Speaker who proposed or confirmed decision")

class MeetingSummarySchema(BaseModel):
    summary_title: str
    executive_summary: str
    key_decisions: List[KeyDecision]
    action_items: List[ActionItem]
    discussion_topics: List[str]
```

---

## 6. Conversation Intelligence, RAG & MCP Integrations

Beyond summarization, meeting platforms convert conversation data into quantitative intelligence metrics, cross-meeting vector search indexers, and Model Context Protocol (MCP) tool servers.

### 6.1 Conversational Dynamics & Analytics Formulas

#### 1. Talk-to-Listen Ratio
Tracks speech airtime distribution across call participants:
$$\text{Talk Ratio}_{\text{Host}} = \left( \frac{\sum \text{Duration}(\text{Utterances}_{\text{Host}})}{\text{Total Meeting Duration}} \right) \times 100$$

#### 2. Speech Cadence (Words Per Minute - WPM)
Calculates vocal delivery speed over total active speech duration:
$$\text{WPM} = \frac{\text{Total Words Spoken}}{\text{Total Active Speech Duration in Minutes}}$$
*   **Slow Cadence**: $< 110 \text{ WPM}$
*   **Optimal Cadence**: $110 - 160 \text{ WPM}$
*   **Fast Cadence**: $> 170 \text{ WPM}$

#### 3. Monologue Threshold
Flags uninterrupted speech segments from a single participant that exceed **90 seconds**.

---

### 6.2 Model Context Protocol (MCP) Integration

The **Model Context Protocol (MCP)** allows local or cloud-based meeting stores to expose search APIs directly to AI tools like Claude Desktop, Cursor IDE, or custom agents.

```
+-------------------+        JSON-RPC 2.0        +--------------------------+
|  Claude Desktop   | <------------------------> | AI Meeting Recorder      |
|  / Cursor IDE     |   (search_transcripts)     | Local MCP Server         |
+-------------------+                            +--------------------------+
                                                              |
                                                              v
                                                     [ Vector Search DB ]
                                                     [ Qdrant / SQLite ]
```

#### Production MCP Tool Definition JSON Schema Response

When an MCP client initializes a connection to the meeting recorder's server, the recorder advertises its search tools using the following JSON-RPC schema structure:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "search_meeting_transcripts",
        "description": "Searches historical meeting transcripts, summaries, action items, and decisions using semantic hybrid vector search.",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Semantic query topic (e.g., 'ScreenCaptureKit migration decision' or 'Q3 budget limits')"
            },
            "date_range": {
              "type": "string",
              "enum": ["past_7_days", "past_30_days", "past_90_days", "all_time"],
              "default": "past_30_days"
            },
            "attendees": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Optional list of attendee names to filter search scope"
            }
          },
          "required": ["query"]
        }
      }
    ]
  }
}
```

---

## 7. Architectural Reference Diagrams

### End-to-End System Integration Flow

```
[ Meeting Ingestion ]
    ├── Native Capture (ScreenCaptureKit / WASAPI)
    └── Cloud Bot Capture (Docker + Playwright + Xvfb)
            │
            v
[ Audio Signal Processing Engine ]
    ├── Echo Cancellation (WebRTC AEC3)
    ├── Noise Suppression (RNNoise / DeepFilterNet)
    └── Gain Control & Normalization (EBU R128)
            │
            v
[ STT & Diarization Pipeline ]
    ├── Dynamic Vocabulary Injection (Calendar metadata)
    ├── Streaming ASR (Deepgram Nova-3 / Whisper)
    └── Speaker Clustering (ECAPA-TDNN embeddings)
            │
            v
[ Storage Layer ]
    ├── Video: Fragmented MP4 (fMP4) -> AWS S3 -> HLS Encrypted
    └── Transcripts: PostgreSQL / SQLite + Vector Store (Qdrant)
            │
            v
[ Summarization & Intelligence ]
    ├── Granola Anchor Expansion Engine
    ├── Map-Reduce Summary Prompts
    ├── Analytics Math (Talk ratios, WPM, Monologues)
    └── Integrations (CRM Rest APIs & Local MCP Server)
```

---
*End of Technical Architecture Blueprint.*