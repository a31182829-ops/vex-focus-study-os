/**
 * VEX Study - Data Transfer Utility
 * Drop this file into your project (e.g. src/lib/vex-data-transfer.js)
 * 
 * Usage:
 * import { exportStudyData, importStudyData, getAllStudyData } from "./vex-data-transfer";
 */

// ============================================
// 1. COLLECT ALL DATA
// ============================================
// ⚠️ IMPORTANT: Update this function with EVERYTHING you store
export function getAllStudyData() {
  return {
    version: 1,
    app: "VEX Study",
    exportedAt: new Date().toISOString(),

    // === Add / edit your real data keys below ===
    theme: localStorage.getItem("vex-theme") || "dark",
    settings: JSON.parse(localStorage.getItem("vex-settings") || "{}"),
    notes: JSON.parse(localStorage.getItem("vex-notes") || "[]"),
    // tasks: JSON.parse(localStorage.getItem("vex-tasks") || "[]"),
    // focusHistory: JSON.parse(localStorage.getItem("vex-focus") || "[]"),
    // Add more keys here as needed
  };
}

// ============================================
// 2. EXPORT (Download as .json file)
// ============================================
export function exportStudyData() {
  try {
    const data = getAllStudyData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10);
    const filename = `vex-study-backup-${date}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  } catch (err) {
    console.error("Export failed:", err);
    alert("Failed to export data.");
    return false;
  }
}

// ============================================
// 3. IMPORT (from .json file)
// ============================================
export function importStudyData(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file selected"));
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const raw = event.target.result;
        const data = JSON.parse(raw);

        // Basic safety check
        if (!data || typeof data !== "object") {
          throw new Error("Invalid file format");
        }

        if (data.app && data.app !== "VEX Study") {
          console.warn("This file may not be from VEX Study");
        }

        // === Restore data ===
        // ⚠️ Update these lines to match getAllStudyData()
        if (data.theme) {
          localStorage.setItem("vex-theme", data.theme);
        }
        if (data.settings) {
          localStorage.setItem("vex-settings", JSON.stringify(data.settings));
        }
        if (data.notes) {
          localStorage.setItem("vex-notes", JSON.stringify(data.notes));
        }
        // if (data.tasks) localStorage.setItem("vex-tasks", JSON.stringify(data.tasks));
        // if (data.focusHistory) localStorage.setItem("vex-focus", JSON.stringify(data.focusHistory));

        resolve(data);
      } catch (err) {
        reject(new Error("Could not read the backup file. Make sure it's a valid VEX export."));
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read the file"));
    };

    reader.readAsText(file);
  });
}

// ============================================
// 4. HELPER - for React menu buttons
// ============================================
export function handleImportClick(event, onSuccess) {
  const file = event.target.files?.[0];
  if (!file) return;

  importStudyData(file)
    .then((data) => {
      if (onSuccess) {
        onSuccess(data);
      } else {
        alert("Data imported successfully!\nThe page will now reload.");
        window.location.reload();
      }
    })
    .catch((err) => {
      alert(err.message || "Import failed");
    })
    .finally(() => {
      // reset input so same file can be selected again
      event.target.value = "";
    });
      }
