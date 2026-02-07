exports.handler = async (event) => {
    console.log("Event:", JSON.stringify(event, null, 2));

    // Simple 200 OK response for both REST and WebSocket
    const response = {
        statusCode: 200,
        body: JSON.stringify({
            message: "Success from Lambda stub",
            status: "OK"
        }),
    };

    return response;
};
