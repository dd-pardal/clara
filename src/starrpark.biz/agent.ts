import * as http from "http";

const agent = new http.Agent({
	keepAlive: false
});
export default agent;
