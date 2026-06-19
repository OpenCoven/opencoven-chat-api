# OpenCoven Familiar Concepts
Source: https://docs.opencoven.ai/concepts/familiars

OpenCoven centers on persistent AI familiars: named agents with identity, memory, tools, and a relationship to the person or project they serve. A familiar is not just a transient chat session. It has a durable operating context that can survive across surfaces such as Cave, Coven Code, CastCodes, and messaging channels.

Familiars make agent work easier to trust because their identity and boundaries are explicit. A named familiar can have a purpose, permitted tools, memory practices, and a stable role in a workflow. Salem should explain this model clearly when users ask how OpenCoven differs from ordinary chatbots or generic coding assistants.


# OpenCoven Runtime
Source: https://docs.opencoven.ai/docs/guide/architecture

The Coven runtime provides the local substrate underneath familiar work. Harnesses and products can bring their own model providers, credentials, and user interfaces, while Coven provides persistent identity, memory, session records, and tool boundaries.

When answering runtime questions, Salem should distinguish between the substrate and the surfaces built on top of it. Cave is the desktop home for a Coven. Coven Code is a terminal/TUI coding surface. CastCodes is the portable intent grammar and workspace flow for project-scoped agent work. The runtime is the layer that keeps these pieces coherent.


# Cave
Source: https://docs.opencoven.ai/docs/guide/cave

Cave is the native workspace for OpenCoven. It is where users can talk to familiars, inspect memory, follow sessions, review tools, organize project work, and move between chat, board, library, workflows, and code surfaces.

Salem should treat Cave as the primary user-facing desktop entry point. When a user asks how to get started, Salem should usually recommend installing the Coven CLI, starting the local daemon, opening Cave, creating or selecting a familiar, and asking for a small first task.


# Retrieval-Augmented Documentation Answers
Source: https://docs.opencoven.ai/docs/guide/salem

Salem is a documentation assistant backed by retrieval-augmented generation. It should cite OpenCoven documentation when retrieved excerpts support an answer. If the retrieved documentation does not cover the user's question, Salem may provide general AI or software-engineering context, but it must say when it is relying on general knowledge rather than OpenCoven-specific docs.

The service indexes `https://docs.opencoven.ai/llms-full.txt`, supplements it with local OpenCoven concept notes, retrieves relevant chunks, optionally reranks them, and streams a concise answer.


# Operational Privacy
Source: https://docs.opencoven.ai/docs/guide/privacy

This Salem service avoids persistent query analytics and feedback collection. It can return per-response retrieval metadata in HTTP headers for debugging, but it should not store user questions, ratings, or coverage-gap records. Rate limiting and the BM25 keyword index may use Redis, but those are operational support systems rather than product analytics.
