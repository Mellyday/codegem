<!-- a975bad7-0510-4ba4-90e1-3829aa472121 c00db4f9-60ae-4765-8b0c-d40e32eaa5ef -->
# GitHub Repo Parser & Code Learning Platform

## Overview

Create a new Next.js application separate from the current Vite/React app. The system will fetch public GitHub repositories, parse supported files (Python initially) into ASTs, store everything in MongoDB Atlas, and provide an interactive learning platform with AST visualization, lessons, and quizzes.

## Technology Stack

- **Frontend**: Next.js 14+ (App Router), React, TailwindCSS
- **Backend**: Next.js API routes (TypeScript)
- **Database**: MongoDB Atlas (free tier)
- **Auth**: Clerk (multi-user with quiz history, scheduling, favorites)
- **Parsing**: tree-sitter (server-side Node.js bindings)
- **Git**: simple-git with shallow clone (`--depth=1`)
- **Deployment**: Localhost + VPS/Coolify ready

## Database Schema (MongoDB)

### Collections:

**users** (managed by Clerk, referenced by userId)

**repos**

```typescript
{
  _id: ObjectId,
  userId: string,           // Clerk user ID
  url: string,              // GitHub repo URL
  name: string,             // repo name
  owner: string,            // repo owner
  clonedPath?: string,      // optional: local path if kept
  status: 'pending' | 'cloning' | 'parsing' | 'completed' | 'failed',
  progress: {
    totalFiles: number,
    parsedFiles: number,
    failedFiles: number,
  },
  createdAt: Date,
  updatedAt: Date,
}
```

**files**

```typescript
{
  _id: ObjectId,
  userId: string,
  repoId: ObjectId,         // reference to repo (null for projects)
  projectId: ObjectId | null, // reference to project
  path: string,             // full file path in repo/project
  language: string,         // 'python', 'javascript', etc.
  extension: string,        // 'py', 'js', etc.
  sourceCode: string,       // original source code
  ast: TreeSitterAstNode,   // parsed AST (as JSON)
  parseStatus: 'success' | 'failed',
  parseError?: string,
  size: number,             // file size in bytes
  createdAt: Date,
  updatedAt: Date,
}
```

**projects**

```typescript
{
  _id: ObjectId,
  userId: string,
  name: string,             // e.g., "LeetCode Solutions"
  description?: string,
  createdAt: Date,
  updatedAt: Date,
}
```

**quizzes** (custom saved quizzes)

```typescript
{
  _id: ObjectId,
  userId: string,
  fileId: ObjectId,         // reference to file
  name: string,
  type: 'custom' | 'lesson-derived',
  rootNode: { type: string, text: string },
  cards: Array<{
    order: number,
    type: string,
    text: string,
    action: 'next' | 'dig',
  }>,
  createdAt: Date,
}
```

**quiz_attempts** (for tracking history)

```typescript
{
  _id: ObjectId,
  userId: string,
  quizId: ObjectId,
  fileId: ObjectId,
  score: number,
  totalQuestions: number,
  completedAt: Date,
}
```

## Implementation Phases

### Phase 1: Backend Foundation & Repo Fetching

**Goal**: Set up Next.js app, MongoDB, Clerk, and implement repo cloning/parsing pipeline.

#### Steps:

1. **Create new Next.js project**

   - Initialize with `npx create-next-app@latest codegem-v2 --typescript --tailwind --app`
   - Set up project structure: `/app`, `/lib`, `/components`, `/models`

2. **Configure environment & dependencies**

   - Install: `mongodb`, `@clerk/nextjs`, `simple-git`, `tree-sitter`, `tree-sitter-python`
   - Create `.env.local`:
     ```
     MONGODB_URI=mongodb+srv://...
     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
     CLERK_SECRET_KEY=...
     ```


3. **Set up MongoDB connection**

   - Create `/lib/mongodb.ts` - connection singleton
   - Define Mongoose models in `/models/` for: Repo, File, Project, Quiz, QuizAttempt

4. **Set up Clerk authentication**

   - Install Clerk middleware and providers
   - Protect API routes and pages requiring auth
   - Create `/app/sign-in` and `/app/sign-up` routes

5. **Implement server-side tree-sitter parsing**

   - Create `/lib/parser/treeSitter.ts` using Node.js tree-sitter bindings
   - Copy AST types from current app (`TreeSitterAstNode` interface)
   - Support Python initially (`.py` files)
   - Return same AST structure as current `treeSitter.ts`

6. **Build repo fetching service**

   - Create `/lib/services/repoFetcher.ts`:
     - Parse GitHub URL to extract owner/name
     - Use `simple-git` with `git clone --depth=1 <url> <temp-dir>`
     - Return cloned directory path
   - Create `/lib/services/repoParser.ts`:
     - Walk directory tree, find parseable files
     - Parse each file with tree-sitter
     - Store File documents in MongoDB with AST
     - Update Repo progress

7. **Create API endpoints**

   - `POST /api/repos/fetch` - accepts GitHub URL, creates Repo record, triggers clone/parse
   - `GET /api/repos` - list user's repos
   - `GET /api/repos/[id]` - get single repo with stats
   - `DELETE /api/repos/[id]` - delete repo and all files
   - `POST /api/repos/[id]/delete-clone` - remove cloned directory, keep DB data

8. **Implement basic job queue (optional for Phase 1)**

   - For Phase 1: run clone/parse synchronously or with simple Promise
   - Later: add BullMQ or similar for background processing

**Key files to copy from current app**:

- `/src/lib/treeSitter.ts` types → adapt for server-side
- `/src/lib/utils.ts` → utility functions

---

### Phase 2: Frontend Repository & Project Browser

**Goal**: Build UI to list, manage repos/projects, and browse their file structure.

#### Steps:

1. **Create dashboard layout**

   - `/app/dashboard/layout.tsx` - sidebar navigation
   - `/app/dashboard/page.tsx` - overview of repos + projects

2. **Repos management page**

   - `/app/dashboard/repos/page.tsx`:
     - Form to input GitHub URL
     - List of user's repos with status badges
     - Show progress bar during parsing
     - Delete button per repo
     - Link to browse repo files
   - Fetch data from `GET /api/repos`

3. **Projects management page**

   - `/app/dashboard/projects/page.tsx`:
     - Create new project (name, description)
     - List user's projects
     - Link to browse project files
   - API: `POST /api/projects`, `GET /api/projects`, `DELETE /api/projects/[id]`

4. **Repo file browser**

   - `/app/dashboard/repos/[repoId]/page.tsx`:
     - Reconstruct folder tree from File documents (using `path` field)
     - Display folders and files in tree view
     - Click file → navigate to `/dashboard/repos/[repoId]/files/[fileId]`
   - API: `GET /api/repos/[id]/files` - returns all files for repo
   - **Note**: Folder structure is "fake" - synthesized from file paths

5. **Project file browser**

   - `/app/dashboard/projects/[projectId]/page.tsx`:
     - Similar to repo browser
     - Allow manual file upload (paste code, save as File document)
   - API: `GET /api/projects/[id]/files`, `POST /api/projects/[id]/files`

6. **Shared file tree component**

   - `/components/FileTree.tsx` - reusable for repos/projects
   - Takes flat file list, builds tree structure, renders folders/files

**Key UI components to copy/adapt**:

- Current app's layout patterns (Header, navigation)
- Styling conventions from `styles.css`

---

### Phase 3: File Viewer with AST, Quiz, and Lesson

**Goal**: Migrate core learning features to the new app when viewing individual files.

#### Steps:

1. **File viewer page**

   - `/app/dashboard/files/[fileId]/page.tsx`:
     - Fetch file from MongoDB (includes sourceCode + ast)
     - Two-column layout: left = AST/Quiz/Lesson, right = source code
   - API: `GET /api/files/[id]` - returns File document

2. **Copy and adapt viewer components**

   - Copy from current app → new app `/components/`:
     - `AstTree.tsx` (for Babel, if added later)
     - `AstChildrenSidebar.tsx` (for tree-sitter AST display)
     - `QuizViewer.tsx`
     - `LessonViewer.tsx`
   - Adapt props: instead of `root` + `code`, receive File object
   - Zoom functionality, node selection/hover - keep as-is

3. **Source code viewer component**

   - `/components/SourceCodeViewer.tsx`:
     - Display code with line numbers
     - Highlight selected/hovered AST node ranges
     - Support reveal mode (progressive for quiz/lesson)
   - Copy highlighting logic from current `SandboxViewer.tsx` (lines 436-528)

4. **Integrate Quiz functionality**

   - Use QuizViewer as-is with file's AST
   - When user saves custom quiz in LessonViewer or QuizViewer:
     - Call `POST /api/quizzes` to save to MongoDB
     - Payload: `{ fileId, name, type, rootNode, cards }`
   - Remove localStorage usage

5. **Quiz history**

   - When quiz completes, save attempt: `POST /api/quiz-attempts`
   - View history: `/app/dashboard/quiz-history/page.tsx`
   - API: `GET /api/quiz-attempts` - list user's attempts

6. **Lesson mode**

   - Keep LessonViewer logic
   - Save custom quiz to MongoDB instead of localStorage

**Key files to copy**:

- `/src/components/SandboxViewer.tsx` → `/components/FileViewer.tsx`
- `/src/components/AstTree.tsx`
- `/src/components/AstChildrenSidebar.tsx`
- `/src/components/QuizViewer.tsx`
- `/src/components/LessonViewer.tsx`

---

### Phase 4: Dashboard Improvements & Background Processing

**Goal**: Add progress tracking, better job management, and repo clone cleanup options.

#### Steps:

1. **Background job system**

   - Add BullMQ (Redis required) or simple in-memory queue
   - Move clone/parse to background jobs
   - API returns job ID, frontend polls for status

2. **Dashboard progress view**

   - `/app/dashboard/jobs/page.tsx`:
     - List all running/completed jobs
     - Show progress per repo (files parsed, failed, remaining)
     - Real-time updates via polling or WebSocket
   - API: `GET /api/jobs`, `GET /api/jobs/[id]`

3. **Clone management**

   - After parsing, show option to "Delete Cloned Files" per repo
   - Keep MongoDB data, remove temp directory
   - API: `POST /api/repos/[id]/delete-clone`

4. **Error handling & retry**

   - Show failed files in dashboard
   - Allow retry for failed repos
   - API: `POST /api/repos/[id]/retry`

5. **Persistent volumes (for VPS)**

   - Document Docker Compose setup with volumes for:
     - MongoDB data (if self-hosting, not needed for Atlas)
     - Cloned repos temp storage (`/tmp/codegem-clones`)
     - Redis (if using BullMQ)
   - For Coolify: configure volume mounts in app settings

---

### Phase 5: Advanced Features

**Goal**: Add quiz scheduling, favorites, improved analytics.

#### Steps:

1. **Favorites**

   - Add `favorites` collection: `{ userId, fileId, createdAt }`
   - Star icon on file viewer
   - `/app/dashboard/favorites/page.tsx` - list starred files
   - API: `POST /api/favorites`, `DELETE /api/favorites/[fileId]`

2. **Quiz scheduling**

   - Add `scheduled_quizzes` collection: `{ userId, quizId, scheduledFor: Date, completed: boolean }`
   - Notification system (email via Clerk/Resend)
   - `/app/dashboard/schedule/page.tsx`
   - API: `POST /api/quizzes/[id]/schedule`

3. **Analytics dashboard**

   - `/app/dashboard/analytics/page.tsx`:
     - Charts: quiz scores over time, most studied files, etc.
     - Use a charting library (recharts, Chart.js)

4. **Multi-language support**

   - Extend tree-sitter parser to support JavaScript, TypeScript, Go, Rust, etc.
   - Update file detection logic
   - Add language-specific grammar WASM files

5. **Collaboration (future)**

   - Share repos/quizzes with other users
   - Leaderboards for friends

---

## Migration Strategy (Parallel Development)

1. **Keep current app running** - no changes to `codegem/` directory
2. **New app in separate directory** - `/Users/schopen/Documents/code/playground/codegem-v2/`
3. **Copy files incrementally** as you implement each phase
4. **Test each phase independently** before moving to next
5. **No downtime** - switch to new app only when feature-complete

## Deployment Considerations

**Localhost**:

- Run Next.js dev server: `npm run dev`
- MongoDB Atlas connection via internet
- Clerk dev keys

**VPS / Coolify**:

- Docker image for Next.js app
- Environment variables via Coolify
- Volume mounts for cloned repos: `/app/tmp/clones`
- No MongoDB volume needed (using Atlas)
- No persistent volumes required for app itself (stateless)

**Environment Variables**:

```env
MONGODB_URI=mongodb+srv://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_APP_URL=https://codegem.yourdomain.com
TEMP_CLONE_DIR=/tmp/codegem-clones
```

## File Structure (New Next.js App)

```
codegem-v2/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/[[...sign-in]]/page.tsx
│   │   └── sign-up/[[...sign-up]]/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx
│   │   ├── page.tsx                    # Overview
│   │   ├── repos/
│   │   │   ├── page.tsx                # Repo list
│   │   │   └── [repoId]/
│   │   │       ├── page.tsx            # File browser
│   │   │       └── files/[fileId]/page.tsx
│   │   ├── projects/
│   │   │   ├── page.tsx
│   │   │   └── [projectId]/
│   │   │       ├── page.tsx
│   │   │       └── files/[fileId]/page.tsx
│   │   ├── files/[fileId]/page.tsx     # Unified file viewer
│   │   ├── quiz-history/page.tsx
│   │   ├── favorites/page.tsx
│   │   ├── jobs/page.tsx               # Phase 4
│   │   └── analytics/page.tsx          # Phase 5
│   ├── api/
│   │   ├── repos/
│   │   │   ├── route.ts                # GET, POST
│   │   │   └── [id]/
│   │   │       ├── route.ts            # GET, DELETE
│   │   │       ├── files/route.ts
│   │   │       ├── delete-clone/route.ts
│   │   │       └── retry/route.ts
│   │   ├── projects/
│   │   │   ├── route.ts
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       └── files/route.ts
│   │   ├── files/[id]/route.ts
│   │   ├── quizzes/
│   │   │   ├── route.ts
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       └── schedule/route.ts
│   │   ├── quiz-attempts/route.ts
│   │   ├── favorites/
│   │   │   ├── route.ts
│   │   │   └── [fileId]/route.ts
│   │   └── jobs/
│   │       ├── route.ts
│   │       └── [id]/route.ts
│   ├── layout.tsx
│   └── page.tsx                        # Landing page
├── components/
│   ├── FileTree.tsx
│   ├── FileViewer.tsx                  # Adapted from SandboxViewer
│   ├── SourceCodeViewer.tsx            # Adapted from SandboxViewer code
│   ├── AstTree.tsx                     # Copied
│   ├── AstChildrenSidebar.tsx          # Copied
│   ├── QuizViewer.tsx                  # Adapted
│   ├── LessonViewer.tsx                # Adapted
│   └── ui/                             # shadcn components
├── lib/
│   ├── mongodb.ts                      # Connection
│   ├── parser/
│   │   ├── treeSitter.ts               # Server-side parser
│   │   └── types.ts                    # TreeSitterAstNode
│   ├── services/
│   │   ├── repoFetcher.ts
│   │   ├── repoParser.ts
│   │   └── fileProcessor.ts
│   └── utils.ts                        # Copied utilities
├── models/
│   ├── Repo.ts
│   ├── File.ts
│   ├── Project.ts
│   ├── Quiz.ts
│   └── QuizAttempt.ts
├── middleware.ts                       # Clerk auth
├── .env.local
├── package.json
└── tsconfig.json
```

## Key Technical Notes

1. **Tree-sitter on server**: Use Node.js bindings (`tree-sitter`, `tree-sitter-python`), not WASM. Much faster for batch processing.

2. **AST storage**: Store full serialized AST as JSON in MongoDB. Consider compression for large files.

3. **Shallow clones**: Always use `git clone --depth=1` to minimize download size for large repos.

4. **File path reconstruction**: Since files are flat in DB, reconstruct folder tree by splitting `path` field and grouping.

5. **Clerk userId**: Use Clerk's `userId` (from `auth()` or `currentUser()`) to scope all data per user.

6. **MongoDB indexes**: Add indexes on `userId`, `repoId`, `projectId`, `path` for fast queries.

7. **Error boundaries**: Wrap all components in error boundaries for graceful handling.

8. **Rate limiting**: Add rate limits to API routes to prevent abuse (especially repo fetching).

## Testing Strategy

- **Phase 1**: Test with small public repos (e.g., single-file Python projects)
- **Phase 2**: Manually test browsing with multi-file repos
- **Phase 3**: Compare AST rendering with current app
- **Phase 4**: Test with large repos (100+ files)
- **Phase 5**: User acceptance testing with friends

## Success Criteria

- ✅ Can fetch and parse public GitHub repos
- ✅ AST visualization matches current app
- ✅ Quiz/Lesson features work identically
- ✅ Custom quizzes persist to MongoDB
- ✅ Multi-user with proper data isolation
- ✅ Deployable to VPS/Coolify
- ✅ Dashboard shows fetch/parse progress
- ✅ Can delete cloned files while keeping DB data

### To-dos

- [ ] Phase 1: Backend Foundation - Set up Next.js project, MongoDB Atlas, Clerk auth, and dependencies
- [ ] Phase 1: Backend Foundation - Implement server-side tree-sitter parser for Python files
- [ ] Phase 1: Backend Foundation - Build repo fetching service with simple-git (shallow clone)
- [ ] Phase 1: Backend Foundation - Create API routes for repo management (fetch, list, delete)
- [ ] Phase 2: Frontend Browser - Build dashboard layout and repos/projects management pages
- [ ] Phase 2: Frontend Browser - Implement file tree browser for repos and projects
- [ ] Phase 3: File Viewer - Copy and adapt AST, Quiz, and Lesson components to new app
- [ ] Phase 3: File Viewer - Migrate custom quiz storage from localStorage to MongoDB
- [ ] Phase 4: Dashboard Improvements - Add background job system and progress tracking
- [ ] Phase 4: Dashboard Improvements - Implement clone cleanup and error retry functionality
- [ ] Phase 5: Advanced Features - Add favorites, quiz scheduling, and analytics