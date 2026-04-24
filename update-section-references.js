import fs from "node:fs";
import path from "node:path";

// Section mapping from old to new
const sectionMapping = {
  "1.1": "3.1",
  "1.2": "3.2",
  "1.3": "3.3",
  "1.4": "3.4",
  "1.5": "3.5",
  "2.1": "2.1",
  "2.2": "2.2",
  "2.3": "2.3",
  "2.3.1": "2.3.1",
  "2.4": "2.4",
  "2.5": "2.5",
  "2.6": "2.6",
  "2.7": "2.7",
  "2.8": "2.8",
  "2.9": "2.9",
  "3.1": "3.1",
  "3.2": "3.2",
  "3.3": "3.3",
  "3.4": "3.4",
  "3.5": "3.5",
  "4.1": "4.1",
  "4.2": "4.2",
  "4.3": "4.3",
  "4.4": "4.4",
  "4.5": "4.5",
  "4.6": "4.6",
  "4.7": "4.7",
  "4.8": "4.8",
  "4.9": "4.9",
  "4.10": "4.10",
  "4.11": "4.11",
  "4.12": "4.12",
  "4.13": "4.13",
  "4.14": "4.14",
  "4.15": "4.15",
  "5.1": "5.1",
  "5.2": "5.2",
  "5.3": "5.3",
  "5.4": "5.4",
  "6.1": "6.1",
  "6.2": "6.2",
  "6.3": "6.3",
  "6.4": "6.4",
  "7.1": "7.1",
  "7.2": "7.2",
  "7.3": "7.3",
  "7.4": "7.4",
  "7.5": "7.5",
  "7.6": "7.6",
  "7.7": "7.7",
  "7.8": "7.8",
  "7.9": "7.9",
  "7.10": "7.10",
  "7.11": "7.11",
  "8.1": "8.1",
  "8.2": "8.2",
  "8.3": "8.3",
  "8.4": "8.4",
  "8.5": "8.5",
  "8.6": "8.6",
  "8.7": "8.7",
  "8.8": "8.8",
  "8.9": "8.9",
  "8.10": "8.10",
  "8.11": "8.11",
  "8.12": "8.12",
  "9.1": "9.1",
  "9.2": "9.2",
  "9.3": "9.3",
  "9.4": "9.4",
  "9.5": "9.5",
  "9.6": "9.6",
  "9.7": "9.7",
  "9.8": "9.8",
  "10.1": "10.1",
  "10.2": "10.2",
  "10.3": "10.3",
  "10.4": "10.4",
  "10.5": "10.5",
  "10.6": "10.6",
  "11": "11",
  "12": "12",
  "13": "13",
  "14": "14",
  "15": "15",
  "16": "16",
  "17": "17",
  "18": "18",
  "19": "19",
  "20": "20",
  "21": "21",

  // Specific mappings from the grep results
  "19.10": "8.1",
  "19.12": "8.11",
  "19.14": "8.7",
  "19.15": "8.8",
  "19.15.3": "8.8",
  "12.7": "8.12",
  "12.8": "8.11",
  "15.1": "5.1",
  "15.1.5": "5.1",
  "15.5": "5.3",
  "20.6.1": "9.8",
};

function updateSectionReferences(content) {
  let updatedContent = content;

  // Update each section reference
  for (const [oldRef, newRef] of Object.entries(sectionMapping)) {
    const regex = new RegExp(`§${oldRef.replace(".", "\\.")}`, "g");
    updatedContent = updatedContent.replace(regex, `§${newRef}`);
  }

  return updatedContent;
}

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const updatedContent = updateSectionReferences(content);

    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent, "utf8");
      console.log(`Updated: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

function findAndProcessFiles(dir, extensions = [".ts", ".tsx", ".js", ".jsx"]) {
  let updatedCount = 0;
  const files = [];

  function findFiles(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name !== "node_modules" && entry.name !== ".git" &&
          entry.name !== ".claude"
        ) {
          findFiles(fullPath);
        }
      } else {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  findFiles(dir);

  for (const file of files) {
    if (processFile(file)) {
      updatedCount++;
    }
  }

  return updatedCount;
}

// Process TypeScript and JavaScript files
const tsUpdatedCount = findAndProcessFiles(".");
console.log(`Updated ${tsUpdatedCount} TypeScript/JavaScript files`);

// Process documentation files
const docUpdatedCount = findAndProcessFiles(".", [".md", ".txt"]);
console.log(`Updated ${docUpdatedCount} documentation files`);

// Process configuration files
const configUpdatedCount = findAndProcessFiles(".", [".json", ".yaml", ".yml"]);
console.log(`Updated ${configUpdatedCount} configuration files`);
