import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";

const execAsync = promisify(exec);

// Types
interface EnvironmentInfo {
  type: 'venv' | 'conda' | 'poetry' | 'system';
  pythonPath: string;
  packageManager: string;
  activationCommand?: string;
  isActive: boolean;
}

interface RequirementFile {
  type: 'requirements.txt' | 'pyproject.toml' | 'setup.py' | 'package.json' | 'Pipfile' | 'environment.yml';
  path: string;
  dependencies: string[];
  devDependencies?: string[];
}

interface InstallationStrategy {
  packageManager: string;
  command: string;
  environment: EnvironmentInfo;
  fallbackCommands: string[];
}

interface ParsedInstruction {
  packageManager: string;
  packages: string[];
  command: string;
  confidence: number;
  source: 'readme' | 'requirements' | 'setup' | 'package.json';
}

// Advanced README parsing with NLP-like patterns
async function parseReadmeIntelligently(readmePath: string): Promise<ParsedInstruction[]> {
  try {
    if (!await fs.pathExists(readmePath)) {
      return [];
    }
    
    const content = await fs.readFile(readmePath, 'utf-8');
    const instructions: ParsedInstruction[] = [];
    
    // Enhanced patterns for different package managers and languages
    const patterns = [
      // Python patterns
      {
        regex: /pip install\s+([^\n\r`]+)/gi,
        packageManager: 'pip',
        confidence: 0.9,
        extractor: (match: string) => match.replace(/pip install\s+/i, '').split(/\s+/).filter(pkg => pkg && !pkg.startsWith('-'))
      },
      {
        regex: /conda install\s+([^\n\r`]+)/gi,
        packageManager: 'conda',
        confidence: 0.9,
        extractor: (match: string) => match.replace(/conda install\s+/i, '').split(/\s+/).filter(pkg => pkg && !pkg.startsWith('-'))
      },
      {
        regex: /poetry add\s+([^\n\r`]+)/gi,
        packageManager: 'poetry',
        confidence: 0.9,
        extractor: (match: string) => match.replace(/poetry add\s+/i, '').split(/\s+/).filter(pkg => pkg && !pkg.startsWith('-'))
      },
      // Node.js patterns
      {
        regex: /npm install\s+([^\n\r`]+)/gi,
        packageManager: 'npm',
        confidence: 0.9,
        extractor: (match: string) => match.replace(/npm install\s+/i, '').split(/\s+/).filter(pkg => pkg && !pkg.startsWith('-'))
      },
      {
        regex: /yarn add\s+([^\n\r`]+)/gi,
        packageManager: 'yarn',
        confidence: 0.9,
        extractor: (match: string) => match.replace(/yarn add\s+/i, '').split(/\s+/).filter(pkg => pkg && !pkg.startsWith('-'))
      },
      // Generic installation patterns
      {
        regex: /install\s+([a-zA-Z0-9\-_@\/]+)/gi,
        packageManager: 'generic',
        confidence: 0.5,
        extractor: (match: string) => [match.replace(/install\s+/i, '').trim()]
      },
      // Requirements file references
      {
        regex: /requirements\.txt|requirements-.*\.txt/gi,
        packageManager: 'pip',
        confidence: 0.7,
        extractor: () => ['requirements.txt']
      }
    ];
    
    patterns.forEach(pattern => {
      const matches = content.match(pattern.regex);
      if (matches) {
        matches.forEach(match => {
          const packages = pattern.extractor(match);
          if (packages.length > 0) {
            instructions.push({
              packageManager: pattern.packageManager,
              packages,
              command: match.trim(),
              confidence: pattern.confidence,
              source: 'readme'
            });
          }
        });
      }
    });
    
    return instructions;
  } catch (error) {
    console.error(chalk.yellow(`⚠️ Could not parse README intelligently: ${error}`));
    return [];
  }
}

// Detect multiple requirement file formats
async function detectRequirementFiles(projectPath: string): Promise<RequirementFile[]> {
  const files: RequirementFile[] = [];
  
  const fileChecks = [
    {
      name: 'requirements.txt',
      type: 'requirements.txt' as const,
      parser: parseRequirementsTxt
    },
    {
      name: 'pyproject.toml',
      type: 'pyproject.toml' as const,
      parser: parsePyprojectToml
    },
    {
      name: 'setup.py',
      type: 'setup.py' as const,
      parser: parseSetupPy
    },
    {
      name: 'package.json',
      type: 'package.json' as const,
      parser: parsePackageJson
    },
    {
      name: 'Pipfile',
      type: 'Pipfile' as const,
      parser: parsePipfile
    },
    {
      name: 'environment.yml',
      type: 'environment.yml' as const,
      parser: parseEnvironmentYml
    }
  ];
  
  for (const check of fileChecks) {
    const filePath = path.join(projectPath, check.name);
    if (await fs.pathExists(filePath)) {
      try {
        const dependencies = await check.parser(filePath);
        files.push({
          type: check.type,
          path: filePath,
          dependencies
        });
      } catch (error) {
        console.error(chalk.yellow(`⚠️ Could not parse ${check.name}: ${error}`));
      }
    }
  }
  
  return files;
}

// Individual parsers for different file formats
async function parseRequirementsTxt(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('-'))
    .map(line => {
      // Handle version specifiers
      const parts = line.split(/[=<>!]/)[0];
      return parts ? parts.trim() : line.trim();
    });
}

async function parsePyprojectToml(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const dependencies: string[] = [];
  
  // Simple TOML parsing for dependencies
  const depMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (depMatch && depMatch[1]) {
    const depSection = depMatch[1];
    const deps = depSection.match(/"([^"]+)"/g);
    if (deps) {
      dependencies.push(...deps.map(dep => {
        const cleaned = dep.replace(/"/g, '').split(/[=<>!]/)[0];
        return cleaned ? cleaned.trim() : dep.trim();
      }));
    }
  }
  
  return dependencies;
}

async function parseSetupPy(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const dependencies: string[] = [];
  
  // Extract install_requires
  const installRequiresMatch = content.match(/install_requires\s*=\s*\[([\s\S]*?)\]/);
  if (installRequiresMatch && installRequiresMatch[1]) {
    const depSection = installRequiresMatch[1];
    const deps = depSection.match(/["']([^"']+)["']/g);
    if (deps) {
      dependencies.push(...deps.map(dep => {
        const cleaned = dep.replace(/["']/g, '').split(/[=<>!]/)[0];
        return cleaned ? cleaned.trim() : dep.trim();
      }));
    }
  }
  
  return dependencies;
}

async function parsePackageJson(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const packageJson = JSON.parse(content);
  const dependencies: string[] = [];
  
  if (packageJson.dependencies) {
    dependencies.push(...Object.keys(packageJson.dependencies));
  }
  if (packageJson.devDependencies) {
    dependencies.push(...Object.keys(packageJson.devDependencies));
  }
  
  return dependencies;
}

async function parsePipfile(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const dependencies: string[] = [];
  
  // Simple Pipfile parsing
  const packagesMatch = content.match(/\[packages\]([\s\S]*?)(?=\[|$)/);
  if (packagesMatch && packagesMatch[1]) {
    const packageSection = packagesMatch[1];
    const deps = packageSection.match(/^([a-zA-Z0-9\-_]+)/gm);
    if (deps) {
      dependencies.push(...deps);
    }
  }
  
  return dependencies;
}

async function parseEnvironmentYml(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const dependencies: string[] = [];

  // Simple YAML parsing for conda environment
  const depMatch = content.match(/dependencies:([\s\S]*?)(?=\n\S|$)/);
  if (depMatch && depMatch[1]) {
    const depSection = depMatch[1];
    const deps = depSection.match(/- ([a-zA-Z0-9\-_]+)/g);
    if (deps) {
      dependencies.push(...deps.map(dep => {
        const cleaned = dep.replace(/^- /, '').split(/[=<>!]/)[0];
        return cleaned ? cleaned.trim() : dep.trim();
      }));
    }
  }

  return dependencies;
}

// Advanced environment detection
async function detectEnvironment(projectPath: string): Promise<EnvironmentInfo> {
  const environments: EnvironmentInfo[] = [];

  // Check for virtual environments
  const venvPaths = [
    path.join(projectPath, 'venv'),
    path.join(projectPath, '.venv'),
    path.join(projectPath, 'env'),
    path.join(projectPath, '.env')
  ];

  for (const venvPath of venvPaths) {
    if (await fs.pathExists(venvPath)) {
      const pythonPath = process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python');

      if (await fs.pathExists(pythonPath)) {
        environments.push({
          type: 'venv',
          pythonPath,
          packageManager: 'pip',
          activationCommand: process.platform === 'win32'
            ? path.join(venvPath, 'Scripts', 'activate.bat')
            : `source ${path.join(venvPath, 'bin', 'activate')}`,
          isActive: false
        });
      }
    }
  }

  // Check for conda environment
  try {
    const condaResult = await execAsync('conda info --envs');
    if (condaResult.stdout.includes(projectPath) || process.env['CONDA_DEFAULT_ENV']) {
      environments.push({
        type: 'conda',
        pythonPath: 'python',
        packageManager: 'conda',
        isActive: !!process.env['CONDA_DEFAULT_ENV']
      });
    }
  } catch (error) {
    // Conda not available
  }

  // Check for poetry
  if (await fs.pathExists(path.join(projectPath, 'pyproject.toml'))) {
    try {
      const poetryResult = await execAsync('poetry --version');
      if (poetryResult.stdout.includes('Poetry')) {
        environments.push({
          type: 'poetry',
          pythonPath: 'poetry run python',
          packageManager: 'poetry',
          isActive: false
        });
      }
    } catch (error) {
      // Poetry not available
    }
  }

  // Fallback to system python
  if (environments.length === 0) {
    environments.push({
      type: 'system',
      pythonPath: 'python',
      packageManager: 'pip',
      isActive: true
    });
  }

  // Return the most appropriate environment (prefer active, then venv, then conda, then poetry, then system)
  const sortedEnvironments = environments.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;

    const priority = { venv: 4, conda: 3, poetry: 2, system: 1 };
    return priority[b.type] - priority[a.type];
  });

  return sortedEnvironments[0] || {
    type: 'system',
    pythonPath: 'python',
    packageManager: 'pip',
    isActive: true
  };
}

// Create installation strategy based on environment and requirements
function createInstallationStrategy(
  environment: EnvironmentInfo,
  requirementFiles: RequirementFile[],
  readmeInstructions: ParsedInstruction[]
): InstallationStrategy {
  const strategy: InstallationStrategy = {
    packageManager: environment.packageManager,
    command: '',
    environment,
    fallbackCommands: []
  };

  // Prioritize explicit instructions from README
  const relevantInstructions = readmeInstructions
    .filter(inst => inst.packageManager === environment.packageManager || inst.packageManager === 'generic')
    .sort((a, b) => b.confidence - a.confidence);

  if (relevantInstructions.length > 0) {
    const bestInstruction = relevantInstructions[0];
    if (bestInstruction) {
      strategy.command = bestInstruction.command;
      strategy.fallbackCommands = relevantInstructions.slice(1).map(inst => inst.command);
    }
  } else {
    // Generate commands based on requirement files
    const pythonFiles = requirementFiles.filter(f =>
      ['requirements.txt', 'pyproject.toml', 'setup.py'].includes(f.type)
    );

    if (pythonFiles.length > 0) {
      const reqFile = pythonFiles[0];
      if (reqFile) {
        switch (environment.type) {
          case 'venv':
            strategy.command = `"${environment.pythonPath}" -m pip install -r "${reqFile.path}"`;
            strategy.fallbackCommands = reqFile.dependencies.map(dep =>
              `"${environment.pythonPath}" -m pip install "${dep}"`
            );
            break;
          case 'conda':
            strategy.command = `conda install --file "${reqFile.path}"`;
            strategy.fallbackCommands = reqFile.dependencies.map(dep => `conda install "${dep}"`);
            break;
          case 'poetry':
            strategy.command = 'poetry install';
            strategy.fallbackCommands = reqFile.dependencies.map(dep => `poetry add "${dep}"`);
            break;
          case 'system':
            strategy.command = `python -m pip install -r "${reqFile.path}"`;
            strategy.fallbackCommands = reqFile.dependencies.map(dep => `python -m pip install "${dep}"`);
            break;
        }
      }
    }
  }

  return strategy;
}

// Execute installation with comprehensive error handling
async function executeInstallation(strategy: InstallationStrategy, projectPath: string): Promise<{
  success: boolean;
  output: string;
  errors: string[];
  warnings: string[];
}> {
  const result = {
    success: false,
    output: '',
    errors: [] as string[],
    warnings: [] as string[]
  };

  console.error(chalk.blue(`🚀 Executing installation strategy: ${strategy.packageManager}`));
  console.error(chalk.yellow(`Command: ${strategy.command}`));

  try {
    // Try main command first
    if (strategy.command) {
      const mainResult = await execAsync(strategy.command, { cwd: projectPath, timeout: 300000 });
      result.output += mainResult.stdout;
      if (mainResult.stderr) {
        result.warnings.push(mainResult.stderr);
      }
      result.success = true;
      console.error(chalk.green(`✅ Installation completed successfully`));
      return result;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result.errors.push(`Main command failed: ${errorMsg}`);
    console.error(chalk.red(`❌ Main command failed: ${errorMsg}`));
  }

  // Try fallback commands
  for (let i = 0; i < strategy.fallbackCommands.length; i++) {
    const fallbackCommand = strategy.fallbackCommands[i];
    if (fallbackCommand) {
      console.error(chalk.yellow(`🔄 Trying fallback command ${i + 1}: ${fallbackCommand}`));

      try {
        const fallbackResult = await execAsync(fallbackCommand, { cwd: projectPath, timeout: 120000 });
        result.output += fallbackResult.stdout;
        if (fallbackResult.stderr) {
          result.warnings.push(fallbackResult.stderr);
        }
        console.error(chalk.green(`✅ Fallback command ${i + 1} succeeded`));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Fallback command ${i + 1} failed: ${errorMsg}`);
        console.error(chalk.red(`❌ Fallback command ${i + 1} failed: ${errorMsg}`));
      }
    }
  }

  // Check if any command succeeded
  result.success = result.errors.length < strategy.fallbackCommands.length + 1;

  return result;
}

// Register the intelligent requirements tool
export async function registerIntelligentRequirementsTools(server: McpServer): Promise<void> {

  server.tool(
    "install_requirements",
    "Intelligently analyze and install requirements from GitHub repositories by reading README files and detecting environment setup",
    {
      projectPath: z.string().describe("Path to the project directory (usually the cloned repository)"),
      comfyuiPath: z.string().optional().describe("Path to ComfyUI installation for environment detection"),
      forcePackageManager: z.enum(['pip', 'conda', 'poetry', 'npm', 'yarn']).optional().describe("Force a specific package manager"),
      dryRun: z.boolean().default(false).describe("Preview installation strategy without executing"),
      includeDevDependencies: z.boolean().default(false).describe("Include development dependencies"),
      verbose: z.boolean().default(false).describe("Show detailed analysis and execution logs")
    },
    async ({ projectPath, comfyuiPath, forcePackageManager, dryRun, verbose }) => {
      const startTime = Date.now();

      try {
        console.error(chalk.blue(`🔍 Analyzing requirements for: ${projectPath}`));

        // Validate project path
        if (!await fs.pathExists(projectPath)) {
          throw new Error(`Project path does not exist: ${projectPath}`);
        }

        // Step 1: Parse README files for installation instructions
        console.error(chalk.blue(`📖 Parsing README files...`));
        const readmePaths = [
          path.join(projectPath, 'README.md'),
          path.join(projectPath, 'readme.md'),
          path.join(projectPath, 'README.txt'),
          path.join(projectPath, 'README.rst')
        ];

        let readmeInstructions: ParsedInstruction[] = [];
        for (const readmePath of readmePaths) {
          if (await fs.pathExists(readmePath)) {
            const instructions = await parseReadmeIntelligently(readmePath);
            readmeInstructions.push(...instructions);
            if (verbose) {
              console.error(chalk.yellow(`Found ${instructions.length} instructions in ${path.basename(readmePath)}`));
            }
            break;
          }
        }

        // Step 2: Detect requirement files
        console.error(chalk.blue(`📋 Detecting requirement files...`));
        const requirementFiles = await detectRequirementFiles(projectPath);
        if (verbose) {
          console.error(chalk.yellow(`Found ${requirementFiles.length} requirement files: ${requirementFiles.map(f => f.type).join(', ')}`));
        }

        // Step 3: Detect environment
        console.error(chalk.blue(`🔍 Detecting environment...`));
        const environment = await detectEnvironment(comfyuiPath || projectPath);
        if (verbose) {
          console.error(chalk.yellow(`Detected environment: ${environment.type} (${environment.packageManager})`));
        }

        // Override package manager if forced
        if (forcePackageManager) {
          environment.packageManager = forcePackageManager;
          if (verbose) {
            console.error(chalk.yellow(`Forced package manager: ${forcePackageManager}`));
          }
        }

        // Step 4: Create installation strategy
        console.error(chalk.blue(`⚙️ Creating installation strategy...`));
        const strategy = createInstallationStrategy(environment, requirementFiles, readmeInstructions);

        const duration = Date.now() - startTime;

        // Prepare output
        const analysisOutput = [
          `🧠 Intelligent Requirements Analysis Complete`,
          ``,
          `📁 Project: ${projectPath}`,
          `⏱️ Analysis Duration: ${duration}ms`,
          ``,
          `🔍 Environment Detection:`,
          `  Type: ${environment.type}`,
          `  Package Manager: ${environment.packageManager}`,
          `  Python Path: ${environment.pythonPath}`,
          `  Active: ${environment.isActive ? 'Yes' : 'No'}`,
          ``,
          `📋 Requirement Files Found: ${requirementFiles.length}`,
          ...requirementFiles.map(f => `  - ${f.type}: ${f.dependencies.length} dependencies`),
          ``,
          `📖 README Instructions Found: ${readmeInstructions.length}`,
          ...readmeInstructions.map(inst => `  - ${inst.packageManager}: ${inst.packages.join(', ')} (confidence: ${inst.confidence})`),
          ``,
          `⚙️ Installation Strategy:`,
          `  Package Manager: ${strategy.packageManager}`,
          `  Main Command: ${strategy.command || 'None'}`,
          `  Fallback Commands: ${strategy.fallbackCommands.length}`,
          verbose ? strategy.fallbackCommands.map(cmd => `    - ${cmd}`).join('\n') : '',
          ``
        ].filter(line => line !== '').join('\n');

        if (dryRun) {
          return {
            content: [{
              type: "text",
              text: analysisOutput + `\n🔍 Dry run completed - no installation performed.`
            }]
          };
        }

        // Step 5: Execute installation
        console.error(chalk.blue(`🚀 Executing installation...`));
        const installResult = await executeInstallation(strategy, projectPath);

        const finalOutput = analysisOutput + [
          ``,
          `🚀 Installation Results:`,
          `  Success: ${installResult.success ? 'Yes' : 'No'}`,
          `  Errors: ${installResult.errors.length}`,
          `  Warnings: ${installResult.warnings.length}`,
          ``,
          installResult.output ? `📤 Output:\n${installResult.output}` : '',
          installResult.errors.length > 0 ? `❌ Errors:\n${installResult.errors.map(e => `  - ${e}`).join('\n')}` : '',
          installResult.warnings.length > 0 ? `⚠️ Warnings:\n${installResult.warnings.map(w => `  - ${w}`).join('\n')}` : '',
          ``,
          `✅ Requirements installation completed.`
        ].filter(line => line !== '').join('\n');

        return {
          content: [{
            type: "text",
            text: finalOutput
          }]
        };

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const duration = Date.now() - startTime;

        console.error(chalk.red(`❌ Requirements analysis failed: ${errorMsg}`));

        return {
          content: [{
            type: "text",
            text: `❌ Intelligent Requirements Analysis Failed\n\nProject: ${projectPath}\nError: ${errorMsg}\nDuration: ${duration}ms`
          }],
          isError: true
        };
      }
    }
  );

  console.error(chalk.green("✅ Intelligent Requirements tools registered"));
}
