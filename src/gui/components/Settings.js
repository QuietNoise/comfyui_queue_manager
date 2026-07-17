"use client";

import React, {useState, useEffect} from "react";
import {baseURL} from "@/internals/config";
import {apiCall} from "@/internals/functions";

const STATUS_OPTIONS = [
  {value: 0, label: "pending"},
  {value: 4, label: "new"},
  {value: 5, label: "priority"},
  {value: 6, label: "main"},
  {value: 7, label: "background"},
];

const TAG_OPTIONS = [
  {value: "priority", label: "priority"},
  {value: "main", label: "main"},
  {value: "background", label: "background"},
  {value: "archive", label: "archive"},
];

export default function Settings() {
  const [defaultStatus, setDefaultStatus] = useState(4);
  const [defaultTag, setDefaultTag] = useState("main");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const response = await fetch(`${baseURL}queue_manager/settings`);
        if (response.ok) {
          const data = await response.json();
          setDefaultStatus(data.default_status);
          setDefaultTag(data.default_tag);
        }
      } catch (error) {
        console.error("Error loading settings:", error);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  async function saveSettings() {
    setSaving(true);
    setMessage(null);
    try {
      await apiCall("queue_manager/settings", {
        default_status: defaultStatus,
        default_tag: defaultTag,
      });
      setMessage({type: "success", text: "Settings saved successfully"});
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({type: "error", text: "Failed to save settings"});
      console.error("Error saving settings:", error);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="italic text-center p-4">Loading settings...</p>;
  }

  return (
    <div className="settings-container p-4 max-w-md mx-auto">
      <h2 className="text-lg font-semibold mb-4 dark:text-neutral-200 text-neutral-800">Settings</h2>

      {/* Default Status */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 dark:text-neutral-300 text-neutral-700">
          Default status for new tasks
        </label>
        <select
          className="w-full px-3 py-2 rounded dark:bg-neutral-800 bg-neutral-200 dark:text-neutral-200 text-neutral-800 border-0 focus:ring-2 focus:ring-blue-500 cursor-pointer"
          value={defaultStatus}
          onChange={(e) => setDefaultStatus(parseInt(e.target.value))}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value}: {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Default Tag */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1 dark:text-neutral-300 text-neutral-700">
          Default tag for new tasks
        </label>
        <select
          className="w-full px-3 py-2 rounded dark:bg-neutral-800 bg-neutral-200 dark:text-neutral-200 text-neutral-800 border-0 focus:ring-2 focus:ring-blue-500 cursor-pointer"
          value={defaultTag}
          onChange={(e) => setDefaultTag(e.target.value)}
        >
          {TAG_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Save Button */}
      <button
        className="px-4 py-2 rounded dark:bg-blue-800 bg-blue-400 dark:text-neutral-200 text-neutral-900 text-sm font-medium hover:opacity-80 disabled:opacity-50"
        onClick={saveSettings}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {/* Message */}
      {message && (
        <p className={`mt-3 text-sm ${message.type === "success" ? "text-green-500" : "text-red-500"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
