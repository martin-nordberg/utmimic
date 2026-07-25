-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Initial schemas
CREATE SCHEMA IF NOT EXISTS sensor_flight_log;
CREATE SCHEMA IF NOT EXISTS live_flight_log;
CREATE SCHEMA IF NOT EXISTS flight_authorizations;
CREATE SCHEMA IF NOT EXISTS drone_registrations;
CREATE SCHEMA IF NOT EXISTS weather;
