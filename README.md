# LMS Assistant

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-blue?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=flat-square&logo=drizzle)](https://orm.drizzle.team/)
[![CI/CD](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)

**LMS Assistant** is an intelligent, full-stack educational companion deeply integrated with **Moodle LMS**. It bridges the gap between institutional course management and personalized learning through bidirectional REST synchronization, multi-provider LLM routing, interactive study artifact generation, and automated instructor gradebook workflows.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |         Next.js 16 Web Client         |
                      | (Tailwind v4, React 19, Lucide, KaTeX)|
                      +-------------------+-------------------+
                                          |
                                HTTP / WebSocket
                                          |
                      +-------------------v-------------------+
                      |      Next.js Serverless Runtime       |
                      |          (App Router Handlers)        |
                      +---+------------------+--------------+-+
                          |                  |              |
                          | REST / Mobile WS |              | Multi-LLM Gateway
                          |                  |              |
           +--------------v----+             |       +------v---------------+
           |    Moodle LMS     |             |       | AI Model Router      |
           | - Core REST API   |             |       | - Google Gemini      |
           | - SSO / Token Auth|             |       | - Anthropic Claude   |
           | - Calendar / Grader             |       | - Groq LPU Engine    |
           +-------------------+             |       | - OpenAI GPT-4o      |
                                             |       | - AI Horde (Zero-cost)
                                             |       +----------------------+
                       +---------------------v--------------------+
                       |           Storage & Data Layer           |
                       | - Firestore (AI Artifacts & Mindmaps)    |
                       | - Supabase / PostgreSQL (Metadata Cache) |
                       | - Cloudinary (Document & Asset CDN)      |
                       +------------------------------------------+
```

---

## Core Capabilities

### 1. Student Experience
* **Bidirectional Moodle Synchronization:** Real-time retrieval of enrolled courses, course materials (PDF, DOCX, PPTX), assignments, deadlines, and grade reports directly from Moodle REST endpoints.
* **Contextual AI Tutor:** Document-grounded conversational agent with citation support, full scientific formula rendering via KaTeX/LaTeX, and streaming responses.
* **Interactive Learning Artifacts:**
  * **Interactive Mindmaps:** Expandable hierarchical branch trees with pan/zoom navigation and high-resolution PNG export.
  * **Smart Summaries:** Structured study notes with instant `.docx` Word file generation.
  * **Active Recall Flashcards:** Flippable concept cards with spaced-repetition layout.
  * **Adaptive Quizzes:** Instant question generation with item-by-item rationales.
* **Avatar Synchronization:** Direct proxying of native Moodle user pictures (`pluginfile.php`) with deterministic SVG gradient fallbacks.

### 2. Instructor Portal
* **Live Grader Report:** Interactive gradebook reflecting Moodle course records with inline editing and batch synchronization.
* **Smart Grade Importer:** AI-assisted Excel/CSV parser featuring fuzzy matching to pair external grade spreadsheets with enrolled Moodle students regardless of column naming conventions.
* **Moodle XML Question Generator:** Generates formatted assessment banks (Single Choice, True/False, Multiple Select with penalization) ready for native import into Moodle Question Banks.
* **Pedagogical Assistant:** Generates rubrics, lesson plans, and announcement drafts aligned with course syllabi.

### 3. Multi-LLM Routing & Resilience
The system employs an abstraction layer across major model providers to ensure high availability and rate-limit mitigation:
* **Google Gemini:** Long-context document ingestion and multimodal parsing (`gemini-2.5-flash`, `gemini-2.5-pro`).
* **Groq LPU:** Ultra-low-latency real-time conversational responses (`llama-3.3-70b`, `gpt-oss-120b`).
* **Anthropic Claude:** Complex pedagogical reasoning and syllabus synthesis (`claude-3-5-sonnet`, `claude-3-7-sonnet`).
* **OpenAI:** Structured data extraction and fuzzy entity alignment (`gpt-4o`, `gpt-4o-mini`).
* **AI Horde:** Distributed compute fallback providing high resilience against external quota exhaustion.

---

## Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS v4, Lucide Icons |
| **Backend & Runtime** | Node.js 22+, Next.js Serverless Functions |
| **LMS Integration** | Moodle REST API (`core_webservice_*`, `core_user_*`, `gradereport_*`) |
| **Database & ORM** | PostgreSQL, Drizzle ORM, Supabase |
| **Document Processing** | `unpdf`, `xlsx`, `docx`, `pptxgenjs` |
| **Math & Markup** | KaTeX, `rehype-katex`, `remark-math`, `remark-gfm` |
| **Cloud Storage** | Cloudinary CDN, Firebase Firestore |
| **Deployment** | Vercel Serverless Platform with Git-driven CI/CD |

---

## Getting Started

### Prerequisites
* **Node.js:** `>= 22.13.0`
* **Package Manager:** `npm` (bundled with Node.js)
* **Moodle Instance:** Moodle 3.11+ or 4.x with Web Services enabled

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/DangHoaiVu/project-graduation.git
   cd project-graduation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the template file and populate your credentials:
   ```bash
   cp .env.example .env.local
   ```
   Key environment variables:
   ```env
   # Moodle Configuration
   MOODLE_URL="https://your-moodle-domain.com"
   MOODLE_TOKEN="your-webservice-token"

   # AI Provider Keys
   GEMINI_API_KEY="your-gemini-key"
   GROQ_API_KEY="your-groq-key"
   OPENAI_API_KEY="your-openai-key"
   ANTHROPIC_API_KEY="your-anthropic-key"

   # Storage & Persistence
   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="your-cloud-name"
   CLOUDINARY_API_KEY="your-api-key"
   CLOUDINARY_API_SECRET="your-api-secret"
   ```

4. **Run Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Production Build:**
   ```bash
   npm run build
   npm run start
   ```

---

## Moodle Web Services Configuration

To enable two-way communication between LMS Assistant and Moodle:

1. **Enable Web Services:**
   * Navigate to `Site Administration > Advanced features`.
   * Check **Enable web services** and save.
2. **Enable REST Protocol:**
   * Go to `Site Administration > Server > Web services > Manage protocols`.
   * Enable the **REST protocol**.
3. **Enable Mobile Service:**
   * Go to `Site Administration > Server > Web services > Mobile`.
   * Enable **Web services for mobile devices**.
4. **Create External Service & Add Functions:**
   * Required functions:
     * `core_webservice_get_site_info`
     * `core_enrol_get_users_courses`
     * `core_course_get_contents`
     * `core_calendar_get_action_events_by_timesort`
     * `gradereport_user_get_grade_items`
     * `gradereport_grader_get_users_undecorated_grades`
     * `core_grades_update_grades`
     * `core_user_get_users_by_field`
5. **Generate Token:**
   * Go to `Site Administration > Server > Web services > Manage tokens`.
   * Create an authorized token for the integration user and assign it to `MOODLE_TOKEN`.

---

## Continuous Integration & Deployment (CI/CD)

The project leverages automated deployment through Vercel's Git Integration:

```
[ Git Push to 'main' ] ──> [ GitHub Webhook ] ──> [ Vercel Build Pipeline ]
                                                            │
                                  ┌─────────────────────────┴─────────────────────────┐
                                  ▼                                                   ▼
                         [ Next.js Build ]                                   [ Serverless Bundle ]
                         - Static optimization                               - API routes packaging
                         - Tailwind v4 CSS compile                           - NFT dependency tracing
                                  │                                                   │
                                  └─────────────────────────┬─────────────────────────┘
                                                            ▼
                                           [ Production Live Deployment ]
                                     https://project-graduation-dran.vercel.app
```

* **Production:** Pushes to the `main` branch trigger an automatic build and zero-downtime production deployment.
* **Preview:** Pull requests automatically provision isolated preview environments with custom preview URLs.

---

## License

This project is licensed under the MIT License.
