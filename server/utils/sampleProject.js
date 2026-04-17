const fs = require('fs');
const path = require('path');
const db = require('../models/db');

const XML_PATH = path.join(__dirname, '..', 'data', 'sample-project.xml');

function stripHtmlTags(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

// Simple XML helpers for our known orbit-export format
function getTagContent(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function getAllBlocks(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

function parseTags(tagsXml) {
  if (!tagsXml) return [];
  return getAllBlocks(tagsXml, 'tag').map(t => t.trim()).filter(Boolean);
}

function parseOrbitXml(xml) {
  const projects = [];
  for (const projXml of getAllBlocks(xml, 'project')) {
    const project = {
      title: getTagContent(projXml, 'title'),
      description: getTagContent(projXml, 'description'),
      tags: parseTags(getTagContent(projXml, 'tags')),
      buckets: [],
    };

    for (const bucketXml of getAllBlocks(projXml, 'bucket')) {
      const bucket = {
        title: getTagContent(bucketXml, 'title'),
        description: getTagContent(bucketXml, 'description'),
        color: getTagContent(bucketXml, 'color') || null,
        tasks: [],
      };

      for (const taskXml of getAllBlocks(bucketXml, 'task')) {
        bucket.tasks.push({
          description: getTagContent(taskXml, 'description'),
          priority: getTagContent(taskXml, 'priority') || 'Medium',
          dueDate: getTagContent(taskXml, 'due-date') || null,
          tags: parseTags(getTagContent(taskXml, 'tags')),
        });
      }

      project.buckets.push(bucket);
    }

    projects.push(project);
  }
  return projects;
}

function createSampleProject(userId) {
  // Check admin setting
  const setting = db.prepare('SELECT value FROM admin_settings WHERE key = ?').get('sample_project_enabled');
  if (setting && setting.value === 'false') return;

  // Read and parse XML
  const xml = fs.readFileSync(XML_PATH, 'utf8');
  const projects = parseOrbitXml(xml);

  for (const proj of projects) {
    const projResult = db.prepare(
      'INSERT INTO projects (user_id, title, description, picture, tags) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, stripHtmlTags(proj.title), stripHtmlTags(proj.description) || null, null, JSON.stringify(proj.tags));

    const projectId = projResult.lastInsertRowid;
    let bucketPos = 0;

    for (const bucket of proj.buckets) {
      bucketPos++;
      const bucketResult = db.prepare(
        'INSERT INTO buckets (project_id, title, description, color, position) VALUES (?, ?, ?, ?, ?)'
      ).run(projectId, stripHtmlTags(bucket.title), stripHtmlTags(bucket.description) || null, bucket.color, bucketPos);

      const bucketId = bucketResult.lastInsertRowid;
      let taskPos = 0;

      for (const task of bucket.tasks) {
        taskPos++;
        db.prepare(
          'INSERT INTO tasks (bucket_id, description, priority, due_date, tags, position, picture, reminder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(bucketId, stripHtmlTags(task.description), task.priority, task.dueDate, JSON.stringify(task.tags), taskPos, null, 0);
      }
    }
  }
}

module.exports = { createSampleProject };
