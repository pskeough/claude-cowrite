import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { PROJECTS_DIR } from '../config.js';

export interface ProjectAnalysisConfig {
  splitChapters: boolean;
  plotAnalysis: boolean;
  characterProfiles: boolean;
  voiceContext: boolean;
  model: 'haiku' | 'sonnet' | 'opus';
}

export interface ProjectStatus {
  splitChapters: 'none' | 'pending' | 'running' | 'done' | 'error';
  plotAnalysis: 'none' | 'pending' | 'running' | 'done' | 'error';
  characterProfiles: 'none' | 'pending' | 'running' | 'done' | 'error';
  voiceContext: 'none' | 'pending' | 'running' | 'done' | 'error';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  bookTitle: string;
  author: string;
  created: string;
  lastOpened?: string;
  rawFile?: string;  // filename within RawFiles/
  analysisConfig: ProjectAnalysisConfig;
  status: ProjectStatus;
}

// Subdirectories created for each project
const PROJECT_SUBDIRS = [
  'RawFiles',
  path.join('Chapters', 'Current'),
  'AI_Analysis_Output',
  'EditorialGuidance_Directions',
  'MiscContext',
];

export function getProjectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

export interface ProjectPaths {
  root: string;
  rawFiles: string;
  chapters: string;
  aiOutput: string;
  editorial: string;
  miscContext: string;
}

export function getProjectPaths(projectId: string): ProjectPaths {
  const root = getProjectDir(projectId);
  return {
    root,
    rawFiles:   path.join(root, 'RawFiles'),
    chapters:   path.join(root, 'Chapters', 'Current'),
    aiOutput:   path.join(root, 'AI_Analysis_Output'),
    editorial:  path.join(root, 'EditorialGuidance_Directions'),
    miscContext: path.join(root, 'MiscContext'),
  };
}

async function ensureProjectsDir(): Promise<void> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

export async function createProject(data: {
  name: string;
  description?: string;
  bookTitle?: string;
  author?: string;
  analysisConfig: ProjectAnalysisConfig;
}): Promise<Project> {
  await ensureProjectsDir();

  const id = randomUUID();
  const project: Project = {
    id,
    name: data.name,
    description: data.description ?? '',
    bookTitle: data.bookTitle ?? data.name,
    author: data.author ?? '',
    created: new Date().toISOString(),
    analysisConfig: data.analysisConfig,
    status: {
      splitChapters:    data.analysisConfig.splitChapters    ? 'pending' : 'none',
      plotAnalysis:     data.analysisConfig.plotAnalysis     ? 'pending' : 'none',
      characterProfiles: data.analysisConfig.characterProfiles ? 'pending' : 'none',
      voiceContext:     data.analysisConfig.voiceContext     ? 'pending' : 'none',
    },
  };

  const projectDir = getProjectDir(id);
  await fs.mkdir(projectDir, { recursive: true });

  for (const subdir of PROJECT_SUBDIRS) {
    await fs.mkdir(path.join(projectDir, subdir), { recursive: true });
  }

  await saveProject(project);
  return project;
}

export async function listProjects(): Promise<Project[]> {
  await ensureProjectsDir();

  let entries: string[];
  try {
    entries = await fs.readdir(PROJECTS_DIR);
  } catch {
    return [];
  }

  const projects: Project[] = [];
  for (const entry of entries) {
    try {
      const content = await fs.readFile(path.join(PROJECTS_DIR, entry, 'project.json'), 'utf-8');
      projects.push(JSON.parse(content) as Project);
    } catch {
      // not a project dir, skip
    }
  }

  return projects.sort((a, b) =>
    new Date(b.created).getTime() - new Date(a.created).getTime(),
  );
}

export async function getProject(id: string): Promise<Project> {
  const content = await fs.readFile(path.join(PROJECTS_DIR, id, 'project.json'), 'utf-8');
  return JSON.parse(content) as Project;
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
  const project = await getProject(id);
  const updated: Project = { ...project, ...updates };
  await saveProject(updated);
  return updated;
}

export async function updateProjectStatus(id: string, statusUpdates: Partial<ProjectStatus>): Promise<Project> {
  const project = await getProject(id);
  const updated: Project = { ...project, status: { ...project.status, ...statusUpdates } };
  await saveProject(updated);
  return updated;
}

async function saveProject(project: Project): Promise<void> {
  const projectJsonPath = path.join(PROJECTS_DIR, project.id, 'project.json');
  await fs.writeFile(projectJsonPath, JSON.stringify(project, null, 2), 'utf-8');
}
