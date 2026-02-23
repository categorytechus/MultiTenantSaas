const assert = require('assert');
const rabbitmq = require('../../orchestrator/utils/rabbitmq');
const amqp = require('amqplib'); // We will mock this

// Mock implementation
const mockChannel = {
    assertExchange: async (exchange, type, options) => {
        console.log(`[Mock] assertExchange: ${exchange}, ${type}`);
        return Promise.resolve();
    },
    assertQueue: async (queue, options) => {
        console.log(`[Mock] assertQueue: ${queue}`);
        return Promise.resolve({ queue });
    },
    bindQueue: async (queue, source, pattern) => {
        console.log(`[Mock] bindQueue: ${queue} <-> ${source} (${pattern})`);
        return Promise.resolve();
    },
    publish: (exchange, routingKey, content, options) => {
        console.log(`[Mock] publish: ${exchange} -> ${routingKey} | ${content.toString()}`);
        return true;
    },
    on: (event, cb) => { },
    close: async () => { }
};

const mockConnection = {
    createChannel: async () => Promise.resolve(mockChannel),
    on: (event, cb) => { },
    close: async () => { }
};

// Override library method
amqp.connect = async (url) => {
    console.log(`[Mock] Connecting to ${url}`);
    return Promise.resolve(mockConnection);
};

// Run Test
const runTest = async () => {
    console.log('--- Starting Mock Test (Shared Queues) ---');
    try {
        // Test publishing to the shared queue
        await rabbitmq.publishMessage('cmd.task.create', { org_id: 'org_test', foo: 'bar' });
        console.log('\n--- Test Passed: Logic executed without error ---');
    } catch (e) {
        console.error('\n--- Test Failed ---', e);
        process.exit(1);
    }
};

runTest();
