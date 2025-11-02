-- Vimflowy PostgreSQL Database Setup
-- Run this script to create the database and tables

-- Create database (run this as postgres superuser)
-- CREATE DATABASE vimflowy;

-- Connect to the database
-- \c vimflowy

-- Create the main data table
CREATE TABLE IF NOT EXISTS vimflowy_data (
  user_id VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_key ON vimflowy_data (user_id, key);

-- Grant permissions (optional, adjust username as needed)
-- GRANT ALL PRIVILEGES ON DATABASE vimflowy TO your_username;
-- GRANT ALL PRIVILEGES ON TABLE vimflowy_data TO your_username;
