# AI Code Review Agent

An AI-powered code review agent for VS Code using the Vercel AI SDK. It allows you to "bring your own provider" (OpenAI, Anthropic, Gemini, Ollama, etc.) to perform comprehensive code reviews directly within your editor.

## Features

- **Review Active File**: Instantly review the file you are currently working on.
- **Review Selection**: Focus the AI's attention on a specific block of code by selecting it.
- **Review Git Changes**: Review staged and unstaged Git diffs to catch issues before committing.
- **Review Selected Files**: Select multiple files in the explorer to review them together.
- **Manage Profiles**: Configure and switch between different AI provider profiles seamlessly.
- **Context Expansion**: The AI can automatically read related files to gain better context for its reviews.
- **Issue Management**: Suppress, unsuppress, and manage ignored issues across your workspace or globally.
- **Inline Annotations**: View review feedback directly inline with your code.
- **Copy Fix Prompts**: Quickly copy AI-ready prompts to help you fix identified issues.

## Configuration

You can customize the extension via the VS Code settings:

- `aiReview.activeProfile`: Set your preferred AI provider profile.
- `aiReview.maxContextFiles`: Control the maximum number of related files the AI can read.
- `aiReview.enableContextExpansion`: Toggle automatic context expansion.
- `aiReview.maxFilesPerReview`: Set limits on the number of files reviewed in a single session.
- `aiReview.maxOutputTokens`: Adjust the maximum token length for AI responses.
- `aiReview.temperature`: Adjust response creativity/predictability.
- `aiReview.suppressionScope`: Choose the default scope (file, workspace, global) for suppressing issues.

## Build and Install

To build and package the extension from source:

1. Clone the repository:

   ```bash
   git clone https://github.com/squall-chua/vscode-ai-code-review.git
   cd vscode-ai-code-review
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the extension:

   ```bash
   npm run build
   ```

4. Package into a `.vsix` file:

   ```bash
   npx vsce package --no-dependencies
   ```

   *This will generate a `vscode-ai-code-review-0.1.0.vsix` file in the root directory.*

5. Install the extension in VS Code:
   - Open VS Code.
   - Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
   - Click the `...` menu in the top right corner.
   - Select **Install from VSIX...**
   - Choose the generated `.vsix` file.

   Alternatively, you can install it via the command line:

   ```bash
   code --install-extension vscode-ai-code-review-0.1.0.vsix
   ```
