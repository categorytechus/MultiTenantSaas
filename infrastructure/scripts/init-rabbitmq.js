const { setupInfrastructure } = require('../../auth-gateway/src/utils/rabbitmq');

const main = async () => {
    try {
        await setupInfrastructure();
        console.log('RabbitMQ Initialization Successful');
        process.exit(0);
    } catch (error) {
        console.error('RabbitMQ Initialization Failed', error);
        process.exit(1);
    }
};

main();
