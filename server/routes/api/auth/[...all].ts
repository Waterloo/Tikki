import { useAuth } from '../../../utils/services'

export default defineEventHandler(event => useAuth().handler(toWebRequest(event)))
