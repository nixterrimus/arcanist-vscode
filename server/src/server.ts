import { connect } from 'http2';
import { URL } from 'url';
import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	TextDocumentSyncKind,
	InitializeResult,
	ResponseError
} from 'vscode-languageserver';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

const { promisify } = require('util');
const exec = promisify(require('child_process').exec)
const url = require('url');
const path = require("path");

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. 
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);


connection.onInitialize((params: InitializeParams) => {
	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			workspace: {
				workspaceFolders: {
					supported: true
				}
			}
		}
	};

	return result;
});


// Event Listeners
documents.onDidOpen(e => {
	validateTextDocument(e.document);
})

documents.onDidSave(e => {
	validateTextDocument(e.document);
})

// Validation function
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	let diagnostics: Diagnostic[] = [];

	const fileUrl = new URL(textDocument.uri)
	const fileUrlString = fileUrl.pathname;
	const baseBath = fileUrlString.substring(0, fileUrlString.lastIndexOf('/'));

	console.log(`Linting ${fileUrlString}`)
	// Figure out the root path, arc seems happiest when running from the root path
	var rootPath: string;

	const workspaceFolders = await connection.workspace.getWorkspaceFolders()
	var workspaceHomeFolder = workspaceFolders[0];

	if (workspaceHomeFolder){
		 const workspaceFolderUrl = new URL(workspaceHomeFolder.uri)
		 rootPath = workspaceFolderUrl.pathname;	
	} else {
		const gitHomingCommand = await exec(`cd ${baseBath}; git rev-parse --show-toplevel`);
		const gitHome = gitHomingCommand.stdout.trim();
		rootPath = gitHome;
	}

	var filePathRelativeToGitHome = path.relative(rootPath, fileUrlString);

	// Check if the file to test is part of the workspace
	if (path.relative(rootPath, fileUrlString).startsWith('..')){
		console.log(`Trying to work on a file, ${fileUrlString}, outside of the workspace, aborting`);
		return;
	}

	try {
		console.log("Running command")
		const arcLintCommand = await exec(`cd ${rootPath}; arc lint --output=json ${fileUrlString}`);
		console.log("Sucesss")
		console.log(arcLintCommand.stdout)
		// If we get this far then there are no errors
	} catch (error) {
		console.log("Fail")
		const output = error.stdout;

		if (error.stderr.trim().startsWith("Exception")){
			// TODO: This should show a popup in the editor
			console.log("Arcanist failed to run")
			return
		}

		const fileErrors = output.split("\n");
		fileErrors
		.filter(e => e.length > 0)
		.forEach(fileError => {
			console.log(fileError)
			const errors = JSON.parse(fileError);
			const errorsForThisFile = errors[filePathRelativeToGitHome];
			if (errorsForThisFile) {
				errorsForThisFile.forEach(fileError => {
					let diagnostic: Diagnostic = {
						severity: DiagnosticSeverity.Error,
						code: fileError.code,
						range: {
							start: {
								line: fileError.line - 1,
								character: 0
							},
							end: {
								line: fileError.line - 1,
								character: Number.MAX_VALUE
							},
						},
						message: fileError.description,
						source: 'arc lint'
					};
					diagnostics.push(diagnostic);
					console.log(JSON.stringify(errorsForThisFile, null, 2));		
				})
			}
		})
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);

connection.listen();
