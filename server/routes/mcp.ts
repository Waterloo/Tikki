import { handleMcpRequest } from '../utils/mcp'

export default defineEventHandler(event => handleMcpRequest(toWebRequest(event)))
