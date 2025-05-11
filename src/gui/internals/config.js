"use client";

export const baseURL = process.env.NODE_ENV === "development"
    ? "http://127.0.0.1:8188/"
    : "/";
