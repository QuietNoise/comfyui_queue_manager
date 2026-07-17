"use client";

export const baseURL = process.env.NODE_ENV === "development"
    ? "http://192.168.1.51:8188/"
    : "/";
